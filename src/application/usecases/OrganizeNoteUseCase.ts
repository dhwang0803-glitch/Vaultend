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
import { getLocale } from '../../i18n';
import {
  TagNormalizationService,
  CanonicalTagGroup,
} from '../../domain/services/TagNormalizationService';

const EMBEDDING_SIMILARITY_THRESHOLD = 0.85;

export interface OrganizeContext {
  readonly sessionTags?: ReadonlyArray<string>;
  readonly cachedCanonicalIndex?: ReadonlyArray<CanonicalTagGroup>;
  readonly cachedTagEmbeddings?: Map<string, Float32Array>;
  readonly cachedVaultTags?: ReadonlyArray<{ tag: string; count: number }>;
  readonly cachedAllNotes?: ReadonlyArray<NotePath>;
}

export class OrganizeNoteUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly config: ConfigPort,
    private readonly tagEmbeddingCache?: TagEmbeddingCachePort,
  ) {}

  async execute(notePath: NotePath, autoApply: boolean, context?: OrganizeContext): Promise<OrganizeResult> {
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

    const vaultTagEntries = remainingTags.length > 0 && this.tagEmbeddingCache
      ? [...freqTags, ...await this.selectRelevantTagsByContent(
          truncatedContent, remainingTags, context?.cachedTagEmbeddings, MAX_RELEVANCE_TAGS,
        )]
      : freqTags;

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

    // Prepare available notes for combined classification + link suggestion
    const MAX_LINK_CANDIDATES = 50;
    const linkCandidates = allNotes.filter(n => n !== notePath);
    const allNoteNames = linkCandidates.map(n => (n as string).replace(/\.md$/, ''));

    const noteTitle = (notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
    const headings = extractHeadings(truncatedContent);
    const noteNames = scoreLinkCandidates(noteTitle, headings, allNoteNames, MAX_LINK_CANDIDATES);

    const classification = await this.aiProvider.callClassification({
      text: truncatedContent,
      task: 'classify-and-tag',
      existingTags: deduplicatedTags,
      locale: getLocale(),
      availableNotes: noteNames.length > 0 ? noteNames : undefined,
    });

    // Validate suggested links against actual vault notes
    const suggestedLinks = this.validateSuggestedLinks(
      classification.suggestedLinks ?? [], linkCandidates,
    );

    // Confidence gating — if below threshold, return minimal result
    const confidenceThreshold = settings.organizeConfidenceThreshold ?? 0;
    if (confidenceThreshold > 0 && classification.confidence < confidenceThreshold) {
      return {
        noteId: note.id,
        notePath,
        classifiedCategory: classification.category,
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

    // 1차: 문자열 정규화 (형태 차이 해결)
    const sanitizedTags = newSuggestedTags
      .map(t => sanitizeTagName(t))
      .filter(t => /^#[\w가-힣\-/]+$/.test(t))
      .filter(t => !currentTagsLower.has(t.toLowerCase()))
      .map(t => TagNormalizationService.resolveToCanonical(t, canonicalIndex));

    // 2차: 임베딩 유사도 (교차 언어 해결) — 정규화에서 매칭 안 된 새 태그만
    const canonicalSet = new Set(canonicalIndex.map(g => g.canonical.toLowerCase()));
    const trulyNewTags = sanitizedTags.filter(t => !canonicalSet.has(t.toLowerCase()));
    let embeddingResolved = new Map<string, string>();
    const emptyUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    let embeddingTokenUsage: TokenUsage = emptyUsage;
    if (trulyNewTags.length > 0) {
      const embeddingResult = await this.resolveByEmbedding(
        trulyNewTags, canonicalIndex, context?.cachedTagEmbeddings,
      );
      embeddingResolved = embeddingResult.resolved;
      embeddingTokenUsage = embeddingResult.tokenUsage;
    }

    const resolvedTags = sanitizedTags.map(t =>
      embeddingResolved.get(t) ?? t,
    );
    const uniqueSanitized = [...new Set(resolvedTags)]
      .filter(t => !currentTagsLower.has(t.toLowerCase()));

    // Build tagReasons map (resolved tag name → reason)
    let tagReasons: ReadonlyMap<string, TagReason> | undefined;
    if (detailMap.size > 0) {
      const reasonMap = new Map<string, TagReason>();
      for (const tag of uniqueSanitized) {
        const lookup = detailMap.get(tag.toLowerCase())
          ?? detailMap.get(tag.replace(/^#/, '').toLowerCase());
        if (lookup) {
          reasonMap.set(tag, { score: lookup.score, isNew: lookup.isNew, reason: lookup.reason });
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
      classifiedCategory: classification.category,
      addedTags: uniqueSanitized.map(t => createTagName(t)),
      suggestedLinks,
      summary: classification.summary,
      tokenUsage: {
        promptTokens: classification.tokenUsage.promptTokens + embeddingTokenUsage.promptTokens,
        completionTokens: classification.tokenUsage.completionTokens + embeddingTokenUsage.completionTokens,
        totalTokens: classification.tokenUsage.totalTokens + embeddingTokenUsage.totalTokens,
        estimatedCostUsd: classification.tokenUsage.estimatedCostUsd + embeddingTokenUsage.estimatedCostUsd,
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
  ): Promise<ReadonlyArray<{ tag: string; count: number }>> {
    try {
      const contentResp = await this.aiProvider.callEmbedding({
        texts: [noteContent.slice(0, 2000)],
      });
      const contentEmb = contentResp.embeddings[0];
      if (!contentEmb) return candidates.slice(0, maxRelevance);

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
      return scored.slice(0, maxRelevance);
    } catch {
      return candidates.slice(0, maxRelevance);
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

  private validateSuggestedLinks(
    rawLinks: ReadonlyArray<string>,
    candidates: ReadonlyArray<NotePath>,
  ): NotePath[] {
    if (rawLinks.length === 0 || candidates.length === 0) return [];

    const basenameToPath = new Map<string, NotePath>();
    for (const n of candidates) {
      const basename = ((n as string).split('/').pop()?.replace(/\.md$/, '') ?? '').toLowerCase();
      if (basename.length >= 3 && !basenameToPath.has(basename)) {
        basenameToPath.set(basename, n);
      }
    }
    const fullPathToNote = new Map<string, NotePath>();
    for (const n of candidates) {
      fullPathToNote.set((n as string).replace(/\.md$/, '').toLowerCase(), n);
    }

    const validated: NotePath[] = [];
    const seen = new Set<string>();

    for (const name of rawLinks) {
      const normalized = name.replace(/\.md$/, '').toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const byFullPath = fullPathToNote.get(normalized);
      if (byFullPath) {
        validated.push(byFullPath);
        continue;
      }

      const basenameOnly = normalized.split('/').pop() ?? '';
      const byBasename = basenameToPath.get(basenameOnly);
      if (byBasename) {
        validated.push(byBasename);
      }
    }

    return validated;
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
        const linkLines = result.suggestedLinks.map(link => {
          const linkPath = (link as string).replace('.md', '');
          return `- [[${linkPath}]]`;
        });
        const section = `\n\n## Related Notes\n\n${linkLines.join('\n')}`;
        await this.vault.writeNote(notePath, currentNote.content + section);
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
}
