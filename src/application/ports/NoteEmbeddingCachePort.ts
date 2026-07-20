import { NotePath } from '../../domain/values/NotePath';

export interface NoteEmbeddingCacheMeta {
  readonly provider: string;
  readonly dimension: number;
  readonly model?: string;
  readonly titleWeight: number;
  readonly bodyWeight: number;
  readonly version: number;
}

export interface NoteEmbeddingEntry {
  readonly notePath: NotePath;
  readonly vector: Float32Array;
  readonly contentHash: string;
  readonly onelineSummary?: string;
}

export interface NoteEmbeddingCachePort {
  load(): Promise<void>;
  flush(): Promise<void>;

  get(notePath: NotePath): NoteEmbeddingEntry | undefined;
  getMany(notePaths: ReadonlyArray<NotePath>): Map<NotePath, NoteEmbeddingEntry>;
  getAll(): Map<NotePath, NoteEmbeddingEntry>;

  put(entry: NoteEmbeddingEntry): void;
  putMany(entries: ReadonlyArray<NoteEmbeddingEntry>): void;

  delete(notePath: NotePath): void;
  retainOnly(validPaths: ReadonlyArray<NotePath>): void;

  getMeta(): NoteEmbeddingCacheMeta | null;
  setMeta(meta: Omit<NoteEmbeddingCacheMeta, 'version'>): void;
  isCompatible(provider: string, dimension: number, titleWeight: number, bodyWeight: number, model?: string): boolean;

  needsUpdate(notePath: NotePath, contentHash: string): boolean;

  clear(): Promise<void>;
  size(): number;
}
