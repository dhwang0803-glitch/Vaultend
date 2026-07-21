import type { VaultAccessPort } from '../ports/VaultAccessPort';
import type { AIProviderPort } from '../ports/AIProviderPort';
import type { TagGroupCachePort, CachedTagGroup } from '../ports/TagGroupCachePort';
import type { ConfigPort } from '../ports/ConfigPort';
import { DuplicateTagGroup } from '../../domain/models/OrganizeModels';
import { TokenUsage } from '../../domain/models/TokenUsage';
import { TagName } from '../../domain/values/TagName';
import { NotePath } from '../../domain/values/NotePath';
import { TagNormalizationService } from '../../domain/services/TagNormalizationService';
import { PromptTemplates } from '../PromptTemplates';
import { parseTagGroupingResponse } from '../utils/parseTagGroupingResponse';
import { detectContentLanguage } from '../utils/detectContentLanguage';
import { TAG_GROUPING_BATCH_SIZE } from '../../constants';

export interface OrganizeTagsProgress {
  readonly phase: 'normalization' | 'llm' | 'building';
  readonly current?: number;
  readonly total?: number;
}

export type OrganizeTagsProgressCallback = (info: OrganizeTagsProgress) => void;

export interface OrganizeTagsResult {
  readonly groups: ReadonlyArray<DuplicateTagGroup>;
  readonly totalTags: number;
  readonly singleUseTags: number;
  readonly tokenUsage?: TokenUsage;
  readonly fromCache?: boolean;
}

export class OrganizeTagsUseCase {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly aiProvider: AIProviderPort | undefined,
    private readonly cache: TagGroupCachePort | undefined,
    private readonly config: ConfigPort,
  ) {}

  async execute(onProgress?: OrganizeTagsProgressCallback): Promise<OrganizeTagsResult> {
    // 1. Load cache + compatibility check
    if (this.cache) {
      await this.cache.load();
      if (this.aiProvider) {
        const settings = await this.config.getSettings();
        const provider = settings.aiProvider;
        const model = settings.aiModel;
        if (!this.cache.isCompatible(provider, model)) {
          await this.cache.clear();
        }
      }
    }

    // 2. Get current tags
    const currentTagEntries = await this.vault.listAllTags();
    const currentTagSet = new Set(currentTagEntries.map(e => e.tag));
    const singleUseTags = currentTagEntries.filter(e => e.count === 1).length;

    // 3. Incremental diff
    const cachedProcessedTags = this.cache?.getProcessedTags() ?? new Set<string>();
    const cachedGroups = this.cache?.getGroups() ?? [];

    const newTags = new Set<string>();
    for (const tag of currentTagSet) {
      if (!cachedProcessedTags.has(tag)) newTags.add(tag);
    }
    const removedTags = new Set<string>();
    for (const tag of cachedProcessedTags) {
      if (!currentTagSet.has(tag)) removedTags.add(tag);
    }

    // Cache hit: no changes and groups exist
    if (newTags.size === 0 && removedTags.size === 0 && cachedGroups.length > 0) {
      onProgress?.({ phase: 'building' });
      const groups = await this.buildDuplicateTagGroups(cachedGroups, currentTagEntries);
      return { groups, totalTags: currentTagEntries.length, singleUseTags, fromCache: true };
    }

    // 4. Clean removed tags from existing groups
    let existingGroups = this.cleanRemovedTags([...cachedGroups], removedTags);

    // 5. Phase 1: String normalization
    onProgress?.({ phase: 'normalization' });
    const canonicalIndex = TagNormalizationService.buildCanonicalIndex(currentTagEntries);

    const normGroups: CachedTagGroup[] = [];
    const singletonTags: Array<{ tag: string; count: number }> = [];

    for (const group of canonicalIndex) {
      if (group.variants.length > 1) {
        normGroups.push({
          canonical: group.canonical,
          variants: group.variants.map(v => v.tag).filter(t => t !== group.canonical),
          source: 'normalization',
        });
      } else {
        singletonTags.push(group.variants[0]);
      }
    }

    // 6. Phase 2: LLM semantic grouping (singletons only)
    let llmGroups: CachedTagGroup[] = [];
    let tokenUsage: TokenUsage | undefined;

    if (this.aiProvider && singletonTags.length > 1) {
      const hasNewSingletons = singletonTags.some(t => newTags.has(t.tag));

      if (hasNewSingletons) {
        // Send ALL singletons so new tags can be compared against existing ungrouped tags
        const result = await this.llmGrouping(singletonTags, normGroups, existingGroups, onProgress);
        llmGroups = result.groups;
        tokenUsage = result.tokenUsage;
      }
    }

    // 7. Merge: normalization + LLM + existing cache (deduplicated)
    const mergedGroups = this.mergeGroups(normGroups, llmGroups, existingGroups);

    // 8. Build reverse index + DuplicateTagGroup output
    onProgress?.({ phase: 'building' });
    const groups = await this.buildDuplicateTagGroups(mergedGroups, currentTagEntries);

    // 9. Persist cache
    if (this.cache) {
      if (this.aiProvider) {
        const settings = await this.config.getSettings();
        this.cache.setMeta({ provider: settings.aiProvider, model: settings.aiModel });
      }
      this.cache.setGroups(mergedGroups, currentTagSet);
      await this.cache.flush();
    }

    return { groups, totalTags: currentTagEntries.length, singleUseTags, tokenUsage };
  }

  private cleanRemovedTags(
    groups: ReadonlyArray<CachedTagGroup>,
    removedTags: ReadonlySet<string>,
  ): CachedTagGroup[] {
    if (removedTags.size === 0) return [...groups];

    const result: CachedTagGroup[] = [];
    for (const g of groups) {
      if (removedTags.has(g.canonical)) continue;
      const filteredVariants = g.variants.filter(v => !removedTags.has(v));
      if (filteredVariants.length === 0) continue;
      result.push({ ...g, variants: filteredVariants });
    }
    return result;
  }

  private async llmGrouping(
    singletons: ReadonlyArray<{ tag: string; count: number }>,
    normGroups: ReadonlyArray<CachedTagGroup>,
    existingGroups: ReadonlyArray<CachedTagGroup>,
    onProgress?: OrganizeTagsProgressCallback,
  ): Promise<{ groups: CachedTagGroup[]; tokenUsage: TokenUsage }> {
    const groups: CachedTagGroup[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalEstimatedCost = 0;

    const totalBatches = Math.ceil(singletons.length / TAG_GROUPING_BATCH_SIZE);

    // Detect language from tag names
    const sampleTags = singletons.slice(0, 5).map(t => t.tag).join(' ');
    const lang = detectContentLanguage(sampleTags);
    const systemPrompt = PromptTemplates.tagGroupingSystemPrompt(lang);

    // Cross-batch: accumulate canonicals from previous batches
    const accumulatedCanonicals: string[] = [
      ...normGroups.map(g => g.canonical),
      ...existingGroups.map(g => g.canonical),
    ];

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      try {
        onProgress?.({ phase: 'llm', current: batchIdx + 1, total: totalBatches });

        const start = batchIdx * TAG_GROUPING_BATCH_SIZE;
        const batch = singletons.slice(start, start + TAG_GROUPING_BATCH_SIZE);

        // Build index map for this batch
        const indexToTag = new Map<number, string>();
        const indexedTags: Array<{ index: number; tag: string; count: number }> = [];
        for (let i = 0; i < batch.length; i++) {
          indexToTag.set(i, batch[i].tag);
          indexedTags.push({ index: i, tag: batch[i].tag, count: batch[i].count });
        }

        const prompt = PromptTemplates.tagGroupingUserMessage(
          indexedTags,
          accumulatedCanonicals.length > 0 ? accumulatedCanonicals : undefined,
          lang,
        );

        const maxTokens = Math.min(4000, Math.max(500, batch.length * 10));

        const response = await this.aiProvider!.callCompletion({
          prompt,
          systemPrompt,
          maxTokens,
          temperature: 0.1,
          jsonMode: true,
        });

        totalPromptTokens += response.tokenUsage.promptTokens;
        totalCompletionTokens += response.tokenUsage.completionTokens;
        totalEstimatedCost += response.tokenUsage.estimatedCostUsd;

        const parsed = parseTagGroupingResponse(response.content, indexToTag);

        for (const pg of parsed) {
          groups.push({
            canonical: pg.canonical,
            variants: [...pg.variants],
            source: 'llm',
            reason: pg.reason,
          });
          accumulatedCanonicals.push(pg.canonical);
        }
      } catch (err) {
        console.error(`Vaultend: tag grouping batch ${batchIdx + 1} failed`, err);
      }
    }

    return {
      groups,
      tokenUsage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        estimatedCostUsd: totalEstimatedCost,
      },
    };
  }

  private mergeGroups(
    normGroups: ReadonlyArray<CachedTagGroup>,
    llmGroups: ReadonlyArray<CachedTagGroup>,
    existingGroups: ReadonlyArray<CachedTagGroup>,
  ): CachedTagGroup[] {
    const canonicalMap = new Map<string, CachedTagGroup>();

    // Normalization groups first (highest priority)
    for (const g of normGroups) {
      canonicalMap.set(g.canonical.toLowerCase(), g);
    }

    // Existing cache groups (lower priority, don't override norm groups)
    for (const g of existingGroups) {
      const key = g.canonical.toLowerCase();
      if (!canonicalMap.has(key)) {
        canonicalMap.set(key, g);
      }
    }

    // LLM groups: merge variants into existing or add new
    for (const g of llmGroups) {
      const key = g.canonical.toLowerCase();
      const existing = canonicalMap.get(key);
      if (existing) {
        const mergedVariants = new Set(existing.variants.map(v => v));
        for (const v of g.variants) {
          mergedVariants.add(v);
        }
        canonicalMap.set(key, {
          ...existing,
          variants: [...mergedVariants],
          reason: existing.reason ?? g.reason,
        });
      } else {
        canonicalMap.set(key, g);
      }
    }

    return [...canonicalMap.values()];
  }

  private async buildDuplicateTagGroups(
    cachedGroups: ReadonlyArray<CachedTagGroup>,
    currentTagEntries: ReadonlyArray<{ tag: string; count: number }>,
  ): Promise<DuplicateTagGroup[]> {
    // Build tag → count map
    const tagCountMap = new Map<string, number>();
    for (const e of currentTagEntries) {
      tagCountMap.set(e.tag.toLowerCase(), e.count);
    }

    // Build reverse index: tag → notePaths (using metadata cache, 0 file I/O)
    const allNotes = await this.vault.listNotesWithMetadata();
    const tagToNotes = new Map<string, NotePath[]>();
    for (const note of allNotes) {
      for (const tag of note.tags) {
        const normalized = tag.toLowerCase();
        const existing = tagToNotes.get(normalized);
        if (existing) {
          existing.push(note.path as unknown as NotePath);
        } else {
          tagToNotes.set(normalized, [note.path as unknown as NotePath]);
        }
      }
    }

    const result: DuplicateTagGroup[] = [];

    for (const group of cachedGroups) {
      const variants: Array<{ tag: TagName; count: number }> = [];

      // Include canonical in variant list for display
      const canonicalCount = tagCountMap.get(group.canonical.toLowerCase()) ?? 0;
      variants.push({ tag: group.canonical as TagName, count: canonicalCount });

      for (const v of group.variants) {
        const count = tagCountMap.get(v.toLowerCase()) ?? 0;
        variants.push({ tag: v as TagName, count });
      }

      // Sort variants: highest count first
      variants.sort((a, b) => b.count - a.count);

      // Affected notes = all notes that have any variant tag
      const affectedNoteSet = new Set<string>();
      for (const v of group.variants) {
        const notes = tagToNotes.get(v.toLowerCase()) ?? [];
        for (const n of notes) {
          affectedNoteSet.add(n as unknown as string);
        }
      }

      const affectedNotes = [...affectedNoteSet].map(p => p as unknown as NotePath);

      result.push({
        canonicalTag: group.canonical as TagName,
        variants,
        affectedNotes,
      });
    }

    // Sort: largest affected notes first
    result.sort((a, b) => b.affectedNotes.length - a.affectedNotes.length);

    return result;
  }
}
