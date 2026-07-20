import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { createTagName, sanitizeTagName } from '../../domain/values/TagName';
import { createTimestamp } from '../../domain/values/Timestamp';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
import { TokenUsage } from '../../domain/models/TokenUsage';
import { NoteNotFoundError } from '../../domain/errors/DomainErrors';
import { applyContentRedaction } from '../../domain/models/PrivacyRule';
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

export interface FolderProfile {
  readonly folder: string;
  readonly topTags: ReadonlyArray<string>;
}

export interface OrganizeContext {
  readonly sessionTags?: ReadonlyArray<string>;
  readonly cachedCanonicalIndex?: ReadonlyArray<CanonicalTagGroup>;
  readonly cachedTagEmbeddings?: Map<string, Float32Array>;
  readonly cachedVaultTags?: ReadonlyArray<{ tag: string; count: number }>;
  readonly cachedFolders?: ReadonlyArray<string>;
  readonly cachedAllNotes?: ReadonlyArray<NotePath>;
  readonly cachedFolderProfiles?: ReadonlyArray<FolderProfile>;
}

export class OrganizeNoteUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly vault: VaultAccessPort,
    private readonly history: HistoryPort,
    private readonly config: ConfigPort,
    private readonly tagEmbeddingCache?: TagEmbeddingCachePort,
  ) {}

  /**
   * 단일 노트를 정리한다: 분류, 태깅, 링크 제안.
   *
   * 1. 노트 내용 읽기
   * 2. AI에게 분류 및 태그 제안 요청
   * 3. 기존 Vault 노트 목록과 대조하여 링크 제안
   * 4. 프론트매터에 태그 추가 (옵션)
   * 5. 결과 반환
   */
  async execute(notePath: NotePath, autoApply: boolean, context?: OrganizeContext): Promise<OrganizeResult> {
    const note = await this.vault.readNote(notePath);
    if (!note) {
      throw new NoteNotFoundError(notePath as string);
    }

    const settings = await this.config.getSettings();
    const currentTags = note.metadata.tags.map(t => t as string);

    // Note list — use cache or fetch
    const allNotes = context?.cachedAllNotes ?? await this.vault.listNotes();
    const existingFolders = context?.cachedFolders ?? await this.vault.listFolders();

    // Vault-wide tags — use cache or fetch
    const MAX_TAGS = 200;
    const vaultTagEntries = context?.cachedVaultTags
      ?? (await this.vault.listAllTags()).slice(0, MAX_TAGS);

    // Canonical index — use cache or build, then merge session tags
    let canonicalIndex = context?.cachedCanonicalIndex
      ?? TagNormalizationService.buildCanonicalIndex(vaultTagEntries);
    if (context?.sessionTags && context.sessionTags.length > 0) {
      canonicalIndex = TagNormalizationService.mergeSessionTags(canonicalIndex, context.sessionTags);
    }
    const deduplicatedTags = canonicalIndex.map(g => g.canonical);

    // Extract current folder for AI context
    const currentFolder = (notePath as string).includes('/')
      ? (notePath as string).substring(0, (notePath as string).lastIndexOf('/'))
      : '';

    // Folder profiles — use cache or build
    const folderProfiles = context?.cachedFolderProfiles
      ?? await this.buildFolderProfiles(existingFolders as string[]);

    // Prepare available notes for combined classification + link suggestion
    const MAX_NOTES = 200;
    const linkCandidates = allNotes.filter(n => n !== notePath);
    const noteNames = linkCandidates
      .slice(0, MAX_NOTES)
      .map(n => (n as string).replace(/\.md$/, ''));

    // AI classification + link suggestion (single API call, prefix-cacheable)
    const redactedContent = applyContentRedaction(note.content, [...settings.privacyRules]);
    const classification = await this.aiProvider.callClassification({
      text: redactedContent,
      task: 'classify-and-tag',
      existingTags: deduplicatedTags,
      folderProfiles: folderProfiles.slice(0, 50),
      currentFolder: currentFolder || undefined,
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
        suggestedMoveTarget: undefined,
        folderReason: classification.folderReason,
        summary: classification.summary,
        tokenUsage: classification.tokenUsage,
        lowConfidence: true,
      };
    }

    // Filter out tags already on the note
    const currentTagsLower = new Set(currentTags.map(t => t.toLowerCase()));
    const newSuggestedTags = classification.suggestedTags
      .filter(t => !currentTagsLower.has(t.toLowerCase()) && !currentTagsLower.has(`#${t}`.toLowerCase()));

    // Folder suggestion — prefer existing folders, allow new folder creation
    const rawFolder = classification.suggestedFolder;
    const suggestedFolder = rawFolder && rawFolder !== currentFolder
      ? rawFolder
      : undefined;

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

    const folderSetForCheck = new Set(existingFolders as string[]);
    const isNewFolder = suggestedFolder ? !folderSetForCheck.has(suggestedFolder) : false;

    let historyEntryId: string | undefined;

    const result: OrganizeResult = {
      noteId: note.id,
      notePath,
      classifiedCategory: classification.category,
      addedTags: uniqueSanitized.map(t => createTagName(t)),
      suggestedLinks,
      suggestedMoveTarget: suggestedFolder,
      folderReason: classification.folderReason,
      isNewFolder,
      summary: classification.summary,
      tokenUsage: {
        promptTokens: classification.tokenUsage.promptTokens + embeddingTokenUsage.promptTokens,
        completionTokens: classification.tokenUsage.completionTokens + embeddingTokenUsage.completionTokens,
        totalTokens: classification.tokenUsage.totalTokens + embeddingTokenUsage.totalTokens,
        estimatedCostUsd: classification.tokenUsage.estimatedCostUsd + embeddingTokenUsage.estimatedCostUsd,
      },
    };

    if (autoApply) {
      historyEntryId = await this.applyOrganization(notePath, result);
    }

    return historyEntryId ? { ...result, historyEntryId } : result;
  }

  private async buildFolderProfiles(folders: ReadonlyArray<string>): Promise<ReadonlyArray<FolderProfile>> {
    const noteEntries = await this.vault.listNotesFolderAndTags();
    const tagCountByFolder = new Map<string, Map<string, number>>();
    for (const entry of noteEntries) {
      if (!entry.folder) continue;
      let tagMap = tagCountByFolder.get(entry.folder);
      if (!tagMap) { tagMap = new Map(); tagCountByFolder.set(entry.folder, tagMap); }
      for (const t of entry.tags) {
        tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
      }
    }
    return folders.map(f => {
      const tagMap = tagCountByFolder.get(f);
      if (!tagMap || tagMap.size === 0) return { folder: f, topTags: [] };
      const sorted = [...tagMap.entries()].sort((a, b) => b[1] - a[1]);
      return { folder: f, topTags: sorted.slice(0, 3).map(([tag]) => tag) };
    });
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

    if (result.suggestedMoveTarget) {
      const filename = (notePath as string).split('/').pop() ?? '';
      const newPath = createNotePath(`${result.suggestedMoveTarget as string}/${filename}`);
      const currentNote = await this.vault.readNote(notePath);
      if (currentNote) {
        await this.vault.writeNote(newPath, currentNote.content);
        await this.vault.updateFrontmatter(newPath, { processed: true });
        await this.vault.deleteNote(notePath);
      }
    }

    const entryId = crypto.randomUUID();
    await this.history.record({
      id: entryId,
      action: 'classify',
      notePath,
      timestamp: createTimestamp(Date.now()),
      description: `Organized: folder=${result.suggestedMoveTarget ?? 'keep'}, tags=${result.addedTags.length}`,
      previousContent,
      metadata: {
        tags: result.addedTags.map(t => t as string),
        links: result.suggestedLinks.map(l => l as string),
        moveTarget: result.suggestedMoveTarget,
      },
    });
    return entryId;
  }
}
