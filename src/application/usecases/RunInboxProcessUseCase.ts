import { OrganizeNoteUseCase, OrganizeContext } from './OrganizeNoteUseCase';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { ConfigPort } from '../ports/ConfigPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { AIProviderPort } from '../ports/AIProviderPort';
import type { TagEmbeddingCachePort } from '../ports/TagEmbeddingCachePort';
import { OrganizeResult } from '../../domain/models/OrganizeModels';
import { NotePath } from '../../domain/values/NotePath';
import { TagNormalizationService } from '../../domain/services/TagNormalizationService';

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

export interface OrganizeFolderResult {
  readonly processedCount: number;
  readonly skippedCount: number;
  readonly results: ReadonlyArray<OrganizeResult>;
  readonly errors: ReadonlyArray<{ path: NotePath; error: string }>;
  readonly cancelled?: boolean;
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
  ) {}

  async execute(options?: OrganizeFolderOptions): Promise<OrganizeFolderResult> {
    const settings = await this.config.getSettings();
    const rawFolder = options?.folder ?? settings.captureFolder;
    const targetFolder = rawFolder === '/' ? undefined : rawFolder;

    const allNotes = await this.vault.listNotes(targetFolder);
    const unprocessedNotes = [];

    for (const notePath of allNotes) {
      const note = await this.vault.readNote(notePath);
      if (note && !note.metadata.isProcessed) {
        unprocessedNotes.push(notePath);
      }
    }

    const results: OrganizeResult[] = [];
    const errors: Array<{ path: NotePath; error: string }> = [];
    let cancelled = false;

    // Batch cache: 1회 조회로 반복 I/O 제거
    const MAX_TAGS = 200;
    const cachedVaultTags = (await this.vault.listAllTags()).slice(0, MAX_TAGS);
    const cachedAllNotes = await this.vault.listNotes();
    const cachedFolders = this.collectFolders(cachedAllNotes);
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
          const newEntries: Array<{ tag: string; vector: Float32Array }> = [];
          for (let i = 0; i < missingTags.length; i++) {
            fromCache.set(missingTags[i], resp.embeddings[i]);
            newEntries.push({ tag: missingTags[i], vector: resp.embeddings[i] });
          }
          this.tagEmbeddingCache?.putMany(newEntries);
        }
        cachedTagEmbeddings = fromCache;
      } catch {
        // embedding 실패 시 문자열 정규화만 사용
      }
    }

    const sessionTags: string[] = [];

    for (let i = 0; i < unprocessedNotes.length; i++) {
      if (options?.signal?.aborted) {
        cancelled = true;
        break;
      }

      const notePath = unprocessedNotes[i];
      options?.onProgress?.({
        current: i + 1,
        total: unprocessedNotes.length,
        currentNotePath: notePath,
      });

      try {
        const context: OrganizeContext = {
          sessionTags,
          cachedCanonicalIndex,
          cachedTagEmbeddings,
          cachedVaultTags,
          cachedFolders,
          cachedAllNotes,
        };

        const result = await this.organizeNote.execute(
          notePath,
          settings.autoApplyOrganize,
          context,
        );
        results.push(result);

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
            const newEntries: Array<{ tag: string; vector: Float32Array }> = [];
            for (let k = 0; k < newTagStrings.length; k++) {
              cachedTagEmbeddings.set(newTagStrings[k], resp.embeddings[k]);
              newEntries.push({ tag: newTagStrings[k], vector: resp.embeddings[k] });
            }
            this.tagEmbeddingCache?.putMany(newEntries);
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

    if (this.tagEmbeddingCache && cachedCanonicalIndex.length > 0) {
      const validTags = cachedCanonicalIndex.map(g => g.canonical);
      this.tagEmbeddingCache.retainOnly([...validTags, ...sessionTags]);
      await this.tagEmbeddingCache.flush();
    }

    return {
      processedCount: results.length,
      skippedCount: allNotes.length - unprocessedNotes.length,
      results,
      errors,
      cancelled,
    };
  }

  private collectFolders(notes: ReadonlyArray<NotePath>): string[] {
    const folderSet = new Set<string>();
    for (const np of notes) {
      const pathStr = np as string;
      const lastSlash = pathStr.lastIndexOf('/');
      if (lastSlash > 0) {
        folderSet.add(pathStr.substring(0, lastSlash));
      }
    }
    return [...folderSet].sort().slice(0, 50);
  }
}
