import { NotePath } from '../../domain/values/NotePath';
import { createTagName, sanitizeTagName } from '../../domain/values/TagName';
import { createTimestamp } from '../../domain/values/Timestamp';
import { OrganizeResult, TagReason } from '../../domain/models/OrganizeModels';
import { TokenUsage } from '../../domain/models/TokenUsage';
import { NoteNotFoundError } from '../../domain/errors/DomainErrors';
import { applyContentRedaction } from '../../domain/models/PrivacyRule';
import { truncateNoteContent, extractHeadings } from '../utils/truncateNoteContent';
import { scoreLinkCandidates } from '../utils/scoreLinkCandidates';
import { AIProviderPort } from '../ports/AIProviderPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ConfigPort } from '../ports/ConfigPort';
import type { TagEmbeddingCachePort } from '../ports/TagEmbeddingCachePort';
import type { NoteEmbeddingCachePort } from '../ports/NoteEmbeddingCachePort';
import type { BuildSummaryIndexUseCase } from './BuildSummaryIndexUseCase';
import { getLocale } from '../../i18n';
import {
  TagNormalizationService,
  CanonicalTagGroup,
} from '../../domain/services/TagNormalizationService';
import { NoteEmbeddingService } from '../../domain/services/NoteEmbeddingService';
import { stripFrontmatter } from '../../domain/services/tokenize';
import { PromptTemplates } from '../PromptTemplates';
import { parseLinkSelectionResponse } from '../utils/parseLinkSelectionResponse';
import { detectContentLanguage } from '../utils/detectContentLanguage';
import { replaceRelatedNotesSection } from '../utils/relatedNotesSection';

const EMBEDDING_SIMILARITY_THRESHOLD = 0.85;

export interface OrganizeContext {
  readonly sessionTags?: ReadonlyArray<string>;
  readonly cachedCanonicalIndex?: ReadonlyArray<CanonicalTagGroup>;
  readonly cachedTagEmbeddings?: Map<string, Float32Array>;
  readonly cachedVaultTags?: ReadonlyArray<{ tag: string; count: number }>;
  readonly cachedAllNotes?: ReadonlyArray<NotePath>;
  readonly cachedNoteEmbeddings?: Map<NotePath, Float32Array>;
  readonly skipLinkSuggestion?: boolean;
  readonly cachedNoteSummaries?: ReadonlyMap<NotePath, string>;
}

export class OrganizeNoteUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly config: ConfigPort,
    private readonly tagEmbeddingCache?: TagEmbeddingCachePort,
    private readonly noteEmbeddingCache?: NoteEmbeddingCachePort,
    private readonly buildSummaryIndex?: BuildSummaryIndexUseCase,
  ) {}

  async execute(notePath: NotePath, autoApply: boolean, context?: OrganizeContext): Promise<OrganizeResult> {
    if (!context) {
      await this.ensureSummaryIndex();
    }

    const note = await this.vault.readNote(notePath);
    if (!note) {
      throw new NoteNotFoundError(notePath as string);
    }

    const settings = await this.config.getSettings();
    const currentTags = note.metadata.tags.map(t => t as string);

    // Note list — use cache or fetch
    const allNotes = context?.cachedAllNotes ?? await this.vault.listNotes();

    // Redact + truncate before any AI call (privacy: no raw content to external APIs)
    const redactedContent = applyContentRedaction(note.content, [...settings.privacyRules]);
    const { content: truncatedContent } = truncateNoteContent(redactedContent);

    // Vault-wide tags — freq top 100 + relevance top 50
    const MAX_FREQ_TAGS = 100;
    const MAX_RELEVANCE_TAGS = 50;
    const allVaultTags = context?.cachedVaultTags ?? await this.vault.listAllTags();
    const freqTags = allVaultTags.slice(0, MAX_FREQ_TAGS);
    const remainingTags = allVaultTags.slice(MAX_FREQ_TAGS);

    let vaultTagEntries: ReadonlyArray<{ tag: string; count: number }>;
    if (remainingTags.length > 0 && this.tagEmbeddingCache) {
      const relevanceResult = await this.selectRelevantTagsByContent(
        truncatedContent, remainingTags, context?.cachedTagEmbeddings, MAX_RELEVANCE_TAGS,
      );
      vaultTagEntries = [...freqTags, ...relevanceResult.tags];
    } else {
      vaultTagEntries = freqTags;
    }

    // Canonical index — use cache or build, then merge session tags
    let canonicalIndex = context?.cachedCanonicalIndex
      ?? TagNormalizationService.buildCanonicalIndex(vaultTagEntries);
    if (context?.sessionTags && context.sessionTags.length > 0) {
      canonicalIndex = TagNormalizationService.mergeSessionTags(canonicalIndex, context.sessionTags);
    }
    // AI prompt tags — only freq + relevance selected subset
    const selectedTagSet = new Set(vaultTagEntries.map(e => e.tag.toLowerCase()));
    const deduplicatedTags = canonicalIndex
      .filter(g => g.variants.some(v => selectedTagSet.has(v.tag.toLowerCase())))
      .map(g => g.canonical);

    const classification = await this.aiProvider.callClassification({
      text: truncatedContent,
      task: 'classify-and-tag',
      existingTags: deduplicatedTags,
      locale: getLocale(),
    });

    const noUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    let suggestedLinks: NotePath[];
    let linkTokenUsage: TokenUsage;

    if (context?.skipLinkSuggestion) {
      suggestedLinks = [];
      linkTokenUsage = noUsage;
    } else {
      const llmResult = await this.computeLLMLinks(
        notePath, classification.onelineSummary, context?.cachedNoteSummaries,
      );
      if (llmResult.links.length > 0) {
        suggestedLinks = llmResult.links;
        linkTokenUsage = llmResult.tokenUsage;
      } else {
        const linkResult = await this.computeEmbeddingLinks(
          notePath, truncatedContent, allNotes, context, settings.linkSimilarityThreshold,
        );
        suggestedLinks = linkResult.links;
        linkTokenUsage = linkResult.tokenUsage;
      }
    }

    // Confidence gating — if below threshold, return minimal result
    const confidenceThreshold = settings.organizeConfidenceThreshold ?? 0;
    if (confidenceThreshold > 0 && classification.confidence < confidenceThreshold) {
      return {
        noteId: note.id,
        notePath,
        classifiedCategory: classification.category ?? '',
        addedTags: [],
        suggestedLinks: [],
        summary: classification.summary,
        tokenUsage: classification.tokenUsage,
        lowConfidence: true,
      };
    }

    // Build reason lookup from tagDetails
    const detailMap = new Map<string, { score: number; isNew: boolean; reason: string }>();
    if (classification.tagDetails) {
      for (const d of classification.tagDetails) {
        detailMap.set(d.tag.toLowerCase(), { score: d.score, isNew: d.isNew, reason: d.reason });
      }
    }

    // Filter out tags already on the note
    const currentTagsLower = new Set(currentTags.map(t => t.toLowerCase()));
    const newSuggestedTags = classification.suggestedTags
      .filter(t => !currentTagsLower.has(t.toLowerCase()) && !currentTagsLower.has(`#${t}`.toLowerCase()));

    // 1차: 문자열 정규화 — track original AI tag for reason propagation
    const tagTransforms: Array<{ original: string; resolved: string }> = [];
    for (const t of newSuggestedTags) {
      const sanitized = sanitizeTagName(t);
      if (!/^#[\w가-힣\-/]+$/.test(sanitized)) continue;
      if (currentTagsLower.has(sanitized.toLowerCase())) continue;
      const canonical = TagNormalizationService.resolveToCanonical(sanitized, canonicalIndex);
      tagTransforms.push({ original: t, resolved: canonical });
    }
    const sanitizedTags = tagTransforms.map(x => x.resolved);

    // 2차: 임베딩 유사도 (교차 언어 해결) — 정규화에서 매칭 안 된 새 태그만
    const canonicalSet = new Set(canonicalIndex.map(g => g.canonical.toLowerCase()));
    const trulyNewTags = sanitizedTags.filter(t => !canonicalSet.has(t.toLowerCase()));
    let embeddingResolved = new Map<string, string>();
    if (trulyNewTags.length > 0) {
      const embeddingResult = await this.resolveByEmbedding(
        trulyNewTags, canonicalIndex, context?.cachedTagEmbeddings,
      );
      embeddingResolved = embeddingResult.resolved;
    }

    // Apply embedding resolution and update transforms
    for (const tx of tagTransforms) {
      const emb = embeddingResolved.get(tx.resolved);
      if (emb) tx.resolved = emb;
    }
    const resolvedTags = tagTransforms.map(tx => tx.resolved);
    const uniqueSanitized = [...new Set(resolvedTags)]
      .filter(t => !currentTagsLower.has(t.toLowerCase()));

    // Build tagReasons — use original AI tag names for lookup (survives canonical/embedding resolution)
    let tagReasons: ReadonlyMap<string, TagReason> | undefined;
    if (detailMap.size > 0) {
      const reasonMap = new Map<string, TagReason>();
      for (const tag of uniqueSanitized) {
        const originals = tagTransforms
          .filter(tx => tx.resolved === tag)
          .map(tx => tx.original);
        let best: { score: number; isNew: boolean; reason: string } | undefined;
        for (const orig of originals) {
          const lookup = detailMap.get(orig.toLowerCase())
            ?? detailMap.get(orig.replace(/^#/, '').toLowerCase());
          if (lookup && (!best || lookup.score > best.score)) best = lookup;
        }
        if (!best) {
          best = detailMap.get(tag.toLowerCase())
            ?? detailMap.get(tag.replace(/^#/, '').toLowerCase());
        }
        if (best) {
          reasonMap.set(tag, { score: best.score, isNew: best.isNew, reason: best.reason });
        }
      }
      if (reasonMap.size > 0) {
        tagReasons = reasonMap;
      }
    }

    let historyEntryId: string | undefined;

    const result: OrganizeResult = {
      noteId: note.id,
      notePath,
      classifiedCategory: classification.category ?? '',
      addedTags: uniqueSanitized.map(t => createTagName(t)),
      suggestedLinks,
      summary: classification.summary,
      onelineSummary: classification.onelineSummary,
      tokenUsage: {
        promptTokens: classification.tokenUsage.promptTokens + linkTokenUsage.promptTokens,
        completionTokens: classification.tokenUsage.completionTokens + linkTokenUsage.completionTokens,
        totalTokens: classification.tokenUsage.totalTokens + linkTokenUsage.totalTokens,
        estimatedCostUsd: classification.tokenUsage.estimatedCostUsd + linkTokenUsage.estimatedCostUsd,
      },
      tagReasons,
    };

    if (autoApply) {
      historyEntryId = await this.applyOrganization(notePath, result);
    }

    return historyEntryId ? { ...result, historyEntryId } : result;
  }

  private async selectRelevantTagsByContent(
    noteContent: string,
    candidates: ReadonlyArray<{ tag: string; count: number }>,
    cachedEmbeddings?: Map<string, Float32Array>,
    maxRelevance: number = 50,
  ): Promise<{ tags: ReadonlyArray<{ tag: string; count: number }>; tokenUsage: TokenUsage }> {
    const noUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    try {
      const contentResp = await this.aiProvider.callEmbedding({
        texts: [noteContent.slice(0, 2000)],
      });
      let totalUsage = { ...contentResp.tokenUsage };
      const addUsage = (u: TokenUsage) => {
        totalUsage = {
          promptTokens: totalUsage.promptTokens + u.promptTokens,
          completionTokens: totalUsage.completionTokens + u.completionTokens,
          totalTokens: totalUsage.totalTokens + u.totalTokens,
          estimatedCostUsd: totalUsage.estimatedCostUsd + u.estimatedCostUsd,
        };
      };
      const contentEmb = contentResp.embeddings[0];
      if (!contentEmb) return { tags: candidates.slice(0, maxRelevance), tokenUsage: totalUsage };

      const tagNames = candidates.map(t => t.tag);

      let tagEmbeddings: Map<string, Float32Array>;
      if (cachedEmbeddings && cachedEmbeddings.size > 0) {
        const fromCache = new Map<string, Float32Array>();
        const missing: string[] = [];
        for (const name of tagNames) {
          const cached = cachedEmbeddings.get(name);
          if (cached) {
            fromCache.set(name, cached);
          } else {
            missing.push(name);
          }
        }
        if (missing.length > 0) {
          const resp = await this.aiProvider.callEmbedding({ texts: missing });
          addUsage(resp.tokenUsage);
          for (let i = 0; i < missing.length; i++) {
            fromCache.set(missing[i], resp.embeddings[i]);
          }
        }
        tagEmbeddings = fromCache;
      } else {
        const fromDisk = this.tagEmbeddingCache?.getMany(tagNames)
          ?? new Map<string, Float32Array>();
        const missing = tagNames.filter(t => !fromDisk.has(t));
        if (missing.length > 0) {
          const resp = await this.aiProvider.callEmbedding({ texts: missing });
          addUsage(resp.tokenUsage);
          for (let i = 0; i < missing.length; i++) {
            fromDisk.set(missing[i], resp.embeddings[i]);
          }
        }
        tagEmbeddings = fromDisk;
      }

      const scored = candidates.map(c => {
        const emb = tagEmbeddings.get(c.tag);
        const sim = emb ? TagNormalizationService.cosineSimilarity(contentEmb, emb) : 0;
        return { ...c, sim };
      });
      scored.sort((a, b) => b.sim - a.sim);
      return { tags: scored.slice(0, maxRelevance), tokenUsage: totalUsage };
    } catch {
      return { tags: candidates.slice(0, maxRelevance), tokenUsage: noUsage };
    }
  }

  private async resolveByEmbedding(
    newTags: string[],
    canonicalIndex: ReadonlyArray<CanonicalTagGroup>,
    cachedEmbeddings?: Map<string, Float32Array>,
  ): Promise<{ resolved: Map<string, string>; tokenUsage: TokenUsage }> {
    const resolved = new Map<string, string>();
    const zeroUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    const canonicals = canonicalIndex.map(g => g.canonical);
    if (canonicals.length === 0) return { resolved, tokenUsage: zeroUsage };

    let totalTokenUsage = { ...zeroUsage };
    const addUsage = (usage: TokenUsage) => {
      totalTokenUsage = {
        promptTokens: totalTokenUsage.promptTokens + usage.promptTokens,
        completionTokens: totalTokenUsage.completionTokens + usage.completionTokens,
        totalTokens: totalTokenUsage.totalTokens + usage.totalTokens,
        estimatedCostUsd: totalTokenUsage.estimatedCostUsd + usage.estimatedCostUsd,
      };
    };

    try {
      let existingEmbeddings: Map<string, Float32Array>;
      if (cachedEmbeddings && cachedEmbeddings.size > 0) {
        existingEmbeddings = cachedEmbeddings;
      } else {
        const fromCache = this.tagEmbeddingCache?.getMany(canonicals)
          ?? new Map<string, Float32Array>();
        const missingTags = canonicals.filter(t => !fromCache.has(t));

        if (missingTags.length > 0) {
          const resp = await this.aiProvider.callEmbedding({ texts: missingTags });
          addUsage(resp.tokenUsage);
          const newEntries: Array<{ tag: string; vector: Float32Array }> = [];
          for (let i = 0; i < missingTags.length; i++) {
            fromCache.set(missingTags[i], resp.embeddings[i]);
            newEntries.push({ tag: missingTags[i], vector: resp.embeddings[i] });
          }
          this.tagEmbeddingCache?.putMany(newEntries);
        }
        existingEmbeddings = fromCache;
      }

      const newResp = await this.aiProvider.callEmbedding({ texts: newTags });
      addUsage(newResp.tokenUsage);

      for (let i = 0; i < newTags.length; i++) {
        let bestTag = '';
        let bestSim = 0;
        for (const [tag, emb] of existingEmbeddings) {
          const sim = TagNormalizationService.cosineSimilarity(newResp.embeddings[i], emb);
          if (sim > bestSim) {
            bestSim = sim;
            bestTag = tag;
          }
        }
        const pairThreshold = bestTag
          ? TagNormalizationService.embeddingMergeThreshold(newTags[i], bestTag)
          : EMBEDDING_SIMILARITY_THRESHOLD;
        if (bestSim >= pairThreshold && bestTag) {
          resolved.set(newTags[i], bestTag);
        }
      }
    } catch {
      // embedding 실패 시 graceful degradation — 문자열 정규화만 사용
    }
    return { resolved, tokenUsage: totalTokenUsage };
  }

  private async computeLLMLinks(
    notePath: NotePath,
    onelineSummary: string | undefined,
    cachedSummaries?: ReadonlyMap<NotePath, string>,
  ): Promise<{ links: NotePath[]; tokenUsage: TokenUsage }> {
    const noUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    try {
      let summaries: ReadonlyMap<NotePath, string> = cachedSummaries ?? new Map();
      if (summaries.size === 0 && this.noteEmbeddingCache) {
        await this.noteEmbeddingCache.load();
        const allEntries = this.noteEmbeddingCache.getAll();
        const loaded = new Map<NotePath, string>();
        for (const [path, entry] of allEntries) {
          if (entry.onelineSummary) loaded.set(path, entry.onelineSummary);
        }
        summaries = loaded;
      }
      if (summaries.size < 2) return { links: [], tokenUsage: noUsage };

      const noteIndexToPath = new Map<number, NotePath>();
      const vaultNotes: Array<{ index: number; title: string; summary: string }> = [];
      let idx = 1;
      for (const [path, summary] of summaries) {
        noteIndexToPath.set(idx, path);
        const title = (path as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
        vaultNotes.push({ index: idx, title, summary });
        idx++;
      }

      const targetIdx = [...noteIndexToPath.entries()].find(([, p]) => p === notePath)?.[0];
      if (!targetIdx) return { links: [], tokenUsage: noUsage };

      const targetTitle = (notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
      const targetSummary = onelineSummary ?? summaries.get(notePath) ?? targetTitle;
      const targets = [{ index: targetIdx, title: targetTitle, summary: targetSummary }];

      const targetIndexToPath = new Map<number, NotePath>([[targetIdx, notePath]]);

      const lang = detectContentLanguage(targetSummary);
      const systemPrompt = PromptTemplates.linkSelectionSystemPrompt(lang);
      const prompt = PromptTemplates.linkSelectionUserMessage(targets, vaultNotes, lang);

      const response = await this.aiProvider.callCompletion({
        prompt,
        systemPrompt,
        maxTokens: 200,
        temperature: 0.1,
        jsonMode: true,
      });

      const linkMap = parseLinkSelectionResponse(response.content, noteIndexToPath, targetIndexToPath);
      return {
        links: linkMap.get(notePath) ?? [],
        tokenUsage: response.tokenUsage,
      };
    } catch (err) {
      console.error('Vaultend: LLM link selection failed', err);
      return { links: [], tokenUsage: noUsage };
    }
  }

  private async computeEmbeddingLinks(
    notePath: NotePath,
    content: string,
    allNotes: ReadonlyArray<NotePath>,
    context?: OrganizeContext,
    threshold?: number,
  ): Promise<{ links: NotePath[]; tokenUsage: TokenUsage }> {
    const noUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    try {
      if (context?.cachedNoteEmbeddings) {
        const currentEmb = context.cachedNoteEmbeddings.get(notePath);
        if (currentEmb) {
          const candidates = new Map<NotePath, Float32Array>();
          for (const [path, emb] of context.cachedNoteEmbeddings) {
            if (path !== notePath) candidates.set(path, emb);
          }
          const similar = NoteEmbeddingService.findSimilarNotes(currentEmb, candidates, threshold);
          return {
            links: similar.map(c => c.notePath),
            tokenUsage: noUsage,
          };
        }
      }

      const title = (notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
      const headings = extractHeadings(content);
      const candidateNotes = allNotes.filter(n => n !== notePath);
      const candidateNames = candidateNotes.map(n => (n as string).replace(/\.md$/, ''));
      const topNames = scoreLinkCandidates(title, headings, candidateNames, 50, content, []);
      if (topNames.length === 0) return { links: [], tokenUsage: noUsage };

      const safeTitle = title || 'untitled';
      const safeBody = stripFrontmatter(content).slice(0, 8000) || title || 'empty';
      const [titleResp, bodyResp, candidateResp] = await Promise.all([
        this.aiProvider.callEmbedding({ texts: [safeTitle] }),
        this.aiProvider.callEmbedding({ texts: [safeBody] }),
        this.aiProvider.callEmbedding({ texts: topNames }),
      ]);

      const linkTokenUsage: TokenUsage = {
        promptTokens: titleResp.tokenUsage.promptTokens + bodyResp.tokenUsage.promptTokens + candidateResp.tokenUsage.promptTokens,
        completionTokens: titleResp.tokenUsage.completionTokens + bodyResp.tokenUsage.completionTokens + candidateResp.tokenUsage.completionTokens,
        totalTokens: titleResp.tokenUsage.totalTokens + bodyResp.tokenUsage.totalTokens + candidateResp.tokenUsage.totalTokens,
        estimatedCostUsd: titleResp.tokenUsage.estimatedCostUsd + bodyResp.tokenUsage.estimatedCostUsd + candidateResp.tokenUsage.estimatedCostUsd,
      };

      const currentEmb = NoteEmbeddingService.combineEmbeddings(
        titleResp.embeddings[0], bodyResp.embeddings[0],
      );

      const nameToPath = new Map<string, NotePath>();
      for (const n of candidateNotes) {
        nameToPath.set((n as string).replace(/\.md$/, ''), n);
      }
      const candidateEmbMap = new Map<NotePath, Float32Array>();
      for (let i = 0; i < topNames.length; i++) {
        const matched = nameToPath.get(topNames[i]);
        if (matched) candidateEmbMap.set(matched, candidateResp.embeddings[i]);
      }

      return {
        links: NoteEmbeddingService.findSimilarNotes(currentEmb, candidateEmbMap, threshold).map(c => c.notePath),
        tokenUsage: linkTokenUsage,
      };
    } catch (err) {
      console.error('Vaultend: embedding link computation failed', err);
      return { links: [], tokenUsage: noUsage };
    }
  }

  private async applyOrganization(
    notePath: NotePath,
    result: OrganizeResult,
  ): Promise<string> {
    const note = await this.vault.readNote(notePath);
    if (!note) return '';
    const previousContent = note.content;

    if (result.addedTags.length > 0) {
      const existingTags = note.metadata.tags.map(t => t as string);
      const newTags = result.addedTags
        .map(t => t as string)
        .filter(t => !existingTags.includes(t));
      if (newTags.length > 0) {
        await this.vault.updateFrontmatter(notePath, {
          tags: [...existingTags, ...newTags],
        });
      }
    }

    if (result.suggestedLinks.length > 0) {
      const currentNote = await this.vault.readNote(notePath);
      if (currentNote) {
        const linkStrs = result.suggestedLinks.map(l => l as string);
        await this.vault.writeNote(notePath, replaceRelatedNotesSection(currentNote.content, linkStrs));
      }
    }

    const entryId = crypto.randomUUID();
    await this.history.record({
      id: entryId,
      action: 'classify',
      notePath,
      timestamp: createTimestamp(Date.now()),
      description: `Organized: tags=${result.addedTags.length}, links=${result.suggestedLinks.length}`,
      previousContent,
      metadata: {
        tags: result.addedTags.map(t => t as string),
        links: result.suggestedLinks.map(l => l as string),
      },
    });
    return entryId;
  }

  private async ensureSummaryIndex(): Promise<void> {
    if (!this.buildSummaryIndex) return;
    await this.buildSummaryIndex.execute();
  }
}
