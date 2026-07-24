import { OrganizeNoteUseCase, OrganizeContext } from './OrganizeNoteUseCase';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { ConfigPort } from '../ports/ConfigPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import type { TagEmbeddingCachePort } from '../ports/TagEmbeddingCachePort';
import type { NoteEmbeddingCachePort } from '../ports/NoteEmbeddingCachePort';
import type { BuildSummaryIndexUseCase } from './BuildSummaryIndexUseCase';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
import { isNoteAllowedByRules } from '../../domain/models/PrivacyRule';
import { TokenUsage } from '../../domain/models/TokenUsage';
import { NotePath } from '../../domain/values/NotePath';
import { createTimestamp } from '../../domain/values/Timestamp';
import { TagNormalizationService } from '../../domain/services/TagNormalizationService';
import { PromptTemplates } from '../PromptTemplates';
import { parseLinkSelectionResponse } from '../utils/parseLinkSelectionResponse';
import { detectContentLanguage } from '../utils/detectContentLanguage';
import { replaceRelatedNotesSection } from '../utils/relatedNotesSection';
import { stripRelatedNotesSection } from '../utils/relatedNotesSection';
import { stripFrontmatter } from '../../domain/services/tokenize';
import { ORGANIZE_MIN_WORD_COUNT, ORGANIZE_SUFFICIENT_LINKS, ORGANIZE_FOLDER_BATCH_SIZE } from '../../constants';

export interface OrganizeFolderProgressInfo {
  readonly current: number;
  readonly total: number;
  readonly currentNotePath: NotePath;
}

export type OrganizeFolderProgressCallback = (info: OrganizeFolderProgressInfo) => void;

export interface OrganizeFolderOptions {
  readonly onProgress?: OrganizeFolderProgressCallback;
  readonly signal?: AbortSignal;
  readonly folder?: string;
}

export interface SkipBreakdown {
  readonly alreadyProcessed: number;
  readonly tooShort: number;
  readonly alreadyLinked: number;
  readonly alreadyOrganized: number;
}

export interface OrganizeFolderResult {
  readonly processedCount: number;
  readonly skippedCount: number;
  readonly skipBreakdown?: SkipBreakdown;
  readonly results: ReadonlyArray<OrganizeResult>;
  readonly errors: ReadonlyArray<{ path: NotePath; error: string }>;
  readonly cancelled?: boolean;
  readonly linkSelectionTokenUsage?: TokenUsage;
  readonly remainingCount: number;
  readonly totalUnprocessed: number;
}

export class OrganizeFolderUseCase {
  constructor(
    private readonly organizeNote: OrganizeNoteUseCase,
    private readonly vault: VaultAccessPort,
    private readonly config: ConfigPort,
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
    private readonly aiProvider?: AIProviderPort,
    private readonly tagEmbeddingCache?: TagEmbeddingCachePort,
    private readonly noteEmbeddingCache?: NoteEmbeddingCachePort,
    private readonly buildSummaryIndex?: BuildSummaryIndexUseCase,
  ) {}

  async execute(options?: OrganizeFolderOptions): Promise<OrganizeFolderResult> {
    await this.ensureSummaryIndex();

    const settings = await this.config.getSettings();
    const rawFolder = options?.folder ?? settings.captureFolder;
    const targetFolder = rawFolder === '/' ? undefined : rawFolder;

    const allNotes = await this.vault.listNotes(targetFolder);
    const unprocessedNotes: NotePath[] = [];
    const privacyRules = [...settings.privacyRules];
    const skipBreakdown: SkipBreakdown = { alreadyProcessed: 0, tooShort: 0, alreadyLinked: 0, alreadyOrganized: 0 };
    const mutableSkip = skipBreakdown as { -readonly [K in keyof SkipBreakdown]: SkipBreakdown[K] };

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (!note) continue;

      const tags = note.metadata.tags.map(t => t as string);
      if (!isNoteAllowedByRules(notePath, tags, note.metadata.frontmatterEntries, privacyRules)) {
        continue;
      }

      if (note.metadata.isProcessed) {
        mutableSkip.alreadyProcessed++;
        continue;
      }

      const bodyText = stripFrontmatter(stripRelatedNotesSection(note.content));
      const wordCount = bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount < ORGANIZE_MIN_WORD_COUNT) {
        mutableSkip.tooShort++;
        continue;
      }

      if (note.metadata.links.length >= ORGANIZE_SUFFICIENT_LINKS) {
        mutableSkip.alreadyLinked++;
        continue;
      }

      const hasRelatedSection = /\n## Related Notes\n/.test(note.content);
      if (hasRelatedSection) {
        mutableSkip.alreadyOrganized++;
        continue;
      }

      unprocessedNotes.push(notePath);
    }

    const totalUnprocessed = unprocessedNotes.length;
    const batchNotes = unprocessedNotes.slice(0, ORGANIZE_FOLDER_BATCH_SIZE);
    const remainingCount = totalUnprocessed - batchNotes.length;

    const results: OrganizeResult[] = [];
    const errors: Array<{ path: NotePath; error: string }> = [];
    let cancelled = false;

    // Batch cache: 1회 조회로 반복 I/O 제거 (OrganizeNoteUseCase가 자체 분할)
    const cachedVaultTags = await this.vault.listAllTags();
    const cachedAllNotes = await this.vault.listNotes();
    const cachedCanonicalIndex = TagNormalizationService.buildCanonicalIndex(cachedVaultTags);

    // canonical 태그 임베딩: 영속 캐시 우선 조회 → miss만 API 호출
    let cachedTagEmbeddings: Map<string, Float32Array> | undefined;
    if (this.aiProvider && cachedCanonicalIndex.length > 0) {
      try {
        const canonicalTags = cachedCanonicalIndex.map(g => g.canonical);
        const fromCache = this.tagEmbeddingCache?.getMany(canonicalTags)
          ?? new Map<string, Float32Array>();
        const missingTags = canonicalTags.filter(t => !fromCache.has(t));

        if (missingTags.length > 0) {
          const resp = await this.aiProvider.callEmbedding({ texts: missingTags });
          if (resp.embeddings.length > 0) {
            const newEntries: Array<{ tag: string; vector: Float32Array }> = [];
            for (let i = 0; i < missingTags.length; i++) {
              if (!resp.embeddings[i]) continue;
              fromCache.set(missingTags[i], resp.embeddings[i]);
              newEntries.push({ tag: missingTags[i], vector: resp.embeddings[i] });
            }
            this.tagEmbeddingCache?.putMany(newEntries);
          }
        }
        cachedTagEmbeddings = fromCache;
      } catch {
        // embedding 실패 시 문자열 정규화만 사용
      }
    }

    // Load note embedding cache for onelineSummary (Pass 2 link selection)
    if (this.noteEmbeddingCache) {
      try {
        await this.noteEmbeddingCache.load();
      } catch {
        // load failure is non-fatal
      }
    }

    // Collect onelineSummary from cache for LLM link selection (Pass 2)
    // Filter by privacy rules to prevent cached summaries of excluded notes from leaking
    const noteSummaryMap = new Map<NotePath, string>();
    if (this.noteEmbeddingCache) {
      const allEntries = this.noteEmbeddingCache.getAll();
      for (const [path, entry] of allEntries) {
        if (!entry.onelineSummary) continue;
        const cachedNote = await this.vault.readNote(path);
        if (!cachedNote) continue;
        const cachedTags = cachedNote.metadata.tags.map(t => t as string);
        if (!isNoteAllowedByRules(path, cachedTags, cachedNote.metadata.frontmatterEntries, privacyRules)) continue;
        noteSummaryMap.set(path, entry.onelineSummary);
      }
    }

    const sessionTags: string[] = [];

    // Pass 1: classify + tag (skip link suggestion — handled in Pass 2)
    for (let i = 0; i < batchNotes.length; i++) {
      if (options?.signal?.aborted) {
        cancelled = true;
        break;
      }

      const notePath = batchNotes[i];
      options?.onProgress?.({
        current: i + 1,
        total: batchNotes.length,
        currentNotePath: notePath,
      });

      try {
        const context: OrganizeContext = {
          sessionTags,
          cachedCanonicalIndex,
          cachedTagEmbeddings,
          cachedVaultTags,
          cachedAllNotes,
          skipLinkSuggestion: true,
        };

        const result = await this.organizeNote.execute(
          notePath,
          settings.autoApplyOrganize,
          context,
        );
        results.push(result);

        if (result.onelineSummary) {
          noteSummaryMap.set(notePath, result.onelineSummary);
          if (this.noteEmbeddingCache) {
            const existing = this.noteEmbeddingCache.get(notePath);
            if (existing) {
              this.noteEmbeddingCache.put({ ...existing, onelineSummary: result.onelineSummary });
            } else {
              this.noteEmbeddingCache.put({
                notePath, vector: new Float32Array(0), contentHash: '',
                onelineSummary: result.onelineSummary,
              });
            }
          }
        }

        // 새 태그를 세션에 누적 + 임베딩 캐시 증분
        const newTagStrings: string[] = [];
        for (const tag of result.addedTags) {
          const tagStr = tag as string;
          sessionTags.push(tagStr);
          if (cachedTagEmbeddings && !cachedTagEmbeddings.has(tagStr)) {
            newTagStrings.push(tagStr);
          }
        }
        if (newTagStrings.length > 0 && this.aiProvider && cachedTagEmbeddings) {
          try {
            const resp = await this.aiProvider.callEmbedding({ texts: newTagStrings });
            if (resp.embeddings.length > 0) {
              const newEntries: Array<{ tag: string; vector: Float32Array }> = [];
              for (let k = 0; k < newTagStrings.length; k++) {
                if (!resp.embeddings[k]) continue;
                cachedTagEmbeddings.set(newTagStrings[k], resp.embeddings[k]);
                newEntries.push({ tag: newTagStrings[k], vector: resp.embeddings[k] });
              }
              this.tagEmbeddingCache?.putMany(newEntries);
            }
          } catch {
            // embedding 실패 시 무시
          }
        }

        if (settings.autoApplyOrganize) {
          const stillExists = await this.vault.exists(notePath);
          if (stillExists) {
            await this.vault.updateFrontmatter(notePath, { processed: true });
          }
        }
      } catch (err) {
        errors.push({
          path: notePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Pass 2: batch LLM link selection (runs regardless of autoApply for preview)
    let batchLinkTokenUsage: TokenUsage | undefined;
    if (results.length > 0 && this.aiProvider && noteSummaryMap.size > 1) {
      try {
        const noteIndexToPath = new Map<number, NotePath>();
        const vaultNotes: Array<{ index: number; title: string; summary: string }> = [];
        let idx = 1;

        const MAX_VAULT_NOTES_FOR_LINK = 200;
        const notesToInclude = cachedAllNotes.slice(0, MAX_VAULT_NOTES_FOR_LINK);
        for (const np of notesToInclude) {
          noteIndexToPath.set(idx, np);
          const title = (np as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
          const summary = noteSummaryMap.get(np) ?? title;
          vaultNotes.push({ index: idx, title, summary });
          idx++;
        }

        const targetIndexToPath = new Map<number, NotePath>();
        const targets: Array<{ index: number; title: string; summary: string }> = [];
        for (const r of results) {
          const tIdx = [...noteIndexToPath.entries()].find(([, p]) => p === r.notePath)?.[0];
          if (!tIdx) continue;
          targetIndexToPath.set(tIdx, r.notePath);
          const title = (r.notePath as string).split('/').pop()?.replace(/\.md$/, '') ?? '';
          targets.push({ index: tIdx, title, summary: r.onelineSummary ?? r.summary });
        }

        if (targets.length > 0) {
          const sampleSummary = targets[0].summary;
          const lang = detectContentLanguage(sampleSummary);
          const systemPrompt = PromptTemplates.linkSelectionSystemPrompt(lang);

          const combinedLinkMap = new Map<NotePath, NotePath[]>();
          let totalPromptTokens = 0;
          let totalCompletionTokens = 0;
          let totalEstimatedCost = 0;

          const BATCH_SIZE = 3;
          for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            try {
              const chunk = targets.slice(i, i + BATCH_SIZE);
              const chunkIndexToPath = new Map<number, NotePath>();
              for (const t of chunk) {
                chunkIndexToPath.set(t.index, targetIndexToPath.get(t.index)!);
              }

              const prompt = PromptTemplates.linkSelectionUserMessage(chunk, vaultNotes, lang);
              const maxTokens = Math.min(4000, Math.max(800, chunk.length * 300));

              const response = await this.aiProvider.callCompletion({
                prompt,
                systemPrompt,
                maxTokens,
                temperature: 0.1,
                jsonMode: true,
              });

              totalPromptTokens += response.tokenUsage.promptTokens;
              totalCompletionTokens += response.tokenUsage.completionTokens;
              totalEstimatedCost += response.tokenUsage.estimatedCostUsd;

              const linkMap = parseLinkSelectionResponse(response.content, noteIndexToPath, chunkIndexToPath);
              for (const [tp, lps] of linkMap) {
                combinedLinkMap.set(tp, lps);
              }
            } catch (batchErr) {
              console.error(`Vaultend: link selection batch ${Math.floor(i / BATCH_SIZE) + 1} failed`, batchErr);
            }
          }

          batchLinkTokenUsage = { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens: totalPromptTokens + totalCompletionTokens, estimatedCostUsd: totalEstimatedCost };

          for (const [targetPath, linkedPaths] of combinedLinkMap) {
            if (linkedPaths.length === 0) continue;

            if (settings.autoApplyOrganize) {
              const note = await this.vault.readNote(targetPath);
              if (note) {
                const previousContent = note.content;
                const linkStrs = linkedPaths.map(lp => lp as string);
                await this.vault.writeNote(targetPath, replaceRelatedNotesSection(note.content, linkStrs));

                await this.history.record({
                  id: crypto.randomUUID(),
                  action: 'classify',
                  notePath: targetPath,
                  timestamp: createTimestamp(Date.now()),
                  description: `Link suggestion: ${linkedPaths.length} links added`,
                  previousContent,
                  metadata: { links: linkedPaths.map(l => l as string) },
                });
              }
            }

            const resultIdx = results.findIndex(r => r.notePath === targetPath);
            if (resultIdx >= 0) {
              results[resultIdx] = { ...results[resultIdx], suggestedLinks: linkedPaths };
            }
          }
        }
      } catch (err) {
        console.error('Vaultend: batch LLM link selection failed', err);
      }
    }

    // Flush note embedding cache (persists onelineSummary)
    if (this.noteEmbeddingCache) {
      try {
        await this.noteEmbeddingCache.flush();
      } catch {
        // flush failure is non-fatal
      }
    }

    if (this.tagEmbeddingCache && cachedCanonicalIndex.length > 0) {
      const validTags = cachedCanonicalIndex.map(g => g.canonical);
      this.tagEmbeddingCache.retainOnly([...validTags, ...sessionTags]);
      await this.tagEmbeddingCache.flush();
    }

    const totalSkipped = mutableSkip.alreadyProcessed + mutableSkip.tooShort + mutableSkip.alreadyLinked + mutableSkip.alreadyOrganized;
    return {
      processedCount: results.length,
      skippedCount: totalSkipped,
      skipBreakdown,
      results,
      errors,
      cancelled,
      linkSelectionTokenUsage: batchLinkTokenUsage,
      remainingCount: cancelled ? remainingCount + (batchNotes.length - results.length - errors.length) : remainingCount,
      totalUnprocessed,
    };
  }

  private async ensureSummaryIndex(): Promise<void> {
    if (!this.buildSummaryIndex) return;
    await this.buildSummaryIndex.execute();
  }
}
