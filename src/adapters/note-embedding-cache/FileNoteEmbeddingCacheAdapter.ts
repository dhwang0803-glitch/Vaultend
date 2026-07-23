import type {
  NoteEmbeddingCachePort,
  NoteEmbeddingCacheMeta,
  NoteEmbeddingEntry,
} from '../../application/ports/NoteEmbeddingCachePort';
import type { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { NotePath } from '../../domain/values/NotePath';
import { NOTE_EMBEDDINGS_PATH } from '../../constants';

const SCHEMA_VERSION = 1;

interface StoredNoteEntry {
  notePath: string;
  vector: string;
  contentHash: string;
  onelineSummary?: string;
}

interface StoredData {
  meta: NoteEmbeddingCacheMeta | null;
  entries: StoredNoteEntry[];
}

export class FileNoteEmbeddingCacheAdapter implements NoteEmbeddingCachePort {
  private cache = new Map<string, { vector: Float32Array; contentHash: string; onelineSummary?: string }>();
  private meta: NoteEmbeddingCacheMeta | null = null;
  private dirty = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly vault: VaultAccessPort) {}

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn);
    this.writeLock = next.then(() => {}, () => {});
    return next;
  }

  async load(): Promise<void> {
    const raw = await this.vault.readFileRaw(NOTE_EMBEDDINGS_PATH);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as StoredData;
      if (!data.meta || !Array.isArray(data.entries)) return;

      this.meta = data.meta;
      this.cache.clear();
      for (const entry of data.entries) {
        this.cache.set(entry.notePath, {
          vector: this.base64ToFloat32(entry.vector),
          contentHash: entry.contentHash,
          onelineSummary: entry.onelineSummary,
        });
      }
    } catch {
      this.cache.clear();
      this.meta = null;
    }
    this.dirty = false;
  }

  async flush(): Promise<void> {
    return this.serialized(async () => {
      if (!this.dirty || !this.meta) return;

      const entries: StoredNoteEntry[] = [];
      for (const [notePath, data] of this.cache) {
        entries.push({
          notePath,
          vector: this.float32ToBase64(data.vector),
          contentHash: data.contentHash,
          ...(data.onelineSummary ? { onelineSummary: data.onelineSummary } : {}),
        });
      }

      const stored: StoredData = { meta: this.meta, entries };
      await this.vault.writeFileRaw(NOTE_EMBEDDINGS_PATH, JSON.stringify(stored));
      this.dirty = false;
    });
  }

  get(notePath: NotePath): NoteEmbeddingEntry | undefined {
    const data = this.cache.get(notePath);
    if (!data) return undefined;
    return { notePath, vector: data.vector, contentHash: data.contentHash, onelineSummary: data.onelineSummary };
  }

  getMany(notePaths: ReadonlyArray<NotePath>): Map<NotePath, NoteEmbeddingEntry> {
    const result = new Map<NotePath, NoteEmbeddingEntry>();
    for (const np of notePaths) {
      const data = this.cache.get(np);
      if (data) {
        result.set(np, { notePath: np, vector: data.vector, contentHash: data.contentHash, onelineSummary: data.onelineSummary });
      }
    }
    return result;
  }

  getAll(): Map<NotePath, NoteEmbeddingEntry> {
    const result = new Map<NotePath, NoteEmbeddingEntry>();
    for (const [path, data] of this.cache) {
      const np = path as NotePath;
      result.set(np, { notePath: np, vector: data.vector, contentHash: data.contentHash, onelineSummary: data.onelineSummary });
    }
    return result;
  }

  put(entry: NoteEmbeddingEntry): void {
    this.cache.set(entry.notePath, {
      vector: entry.vector,
      contentHash: entry.contentHash,
      onelineSummary: entry.onelineSummary,
    });
    this.dirty = true;
  }

  putMany(entries: ReadonlyArray<NoteEmbeddingEntry>): void {
    for (const entry of entries) {
      this.cache.set(entry.notePath, {
        vector: entry.vector,
        contentHash: entry.contentHash,
        onelineSummary: entry.onelineSummary,
      });
    }
    if (entries.length > 0) this.dirty = true;
  }

  delete(notePath: NotePath): void {
    if (this.cache.delete(notePath)) {
      this.dirty = true;
    }
  }

  retainOnly(validPaths: ReadonlyArray<NotePath>): void {
    const validSet = new Set(validPaths.map(p => p as string));
    for (const key of this.cache.keys()) {
      if (!validSet.has(key)) {
        this.cache.delete(key);
        this.dirty = true;
      }
    }
  }

  getMeta(): NoteEmbeddingCacheMeta | null {
    return this.meta;
  }

  setMeta(meta: Omit<NoteEmbeddingCacheMeta, 'version'>): void {
    this.meta = { ...meta, version: SCHEMA_VERSION };
    this.dirty = true;
  }

  isCompatible(
    provider: string,
    dimension: number,
    titleWeight: number,
    bodyWeight: number,
    model?: string,
  ): boolean {
    if (!this.meta) return false;
    if (this.meta.provider !== provider || this.meta.dimension !== dimension) return false;
    if (this.meta.titleWeight !== titleWeight || this.meta.bodyWeight !== bodyWeight) return false;
    if (model !== undefined && this.meta.model !== model) return false;
    return true;
  }

  needsUpdate(notePath: NotePath, contentHash: string): boolean {
    const data = this.cache.get(notePath);
    if (!data) return true;
    return data.contentHash !== contentHash;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.meta = null;
    this.dirty = false;
    await this.vault.writeFileRaw(NOTE_EMBEDDINGS_PATH, JSON.stringify({ meta: null, entries: [] }));
  }

  size(): number {
    return this.cache.size;
  }

  private float32ToBase64(arr: Float32Array): string {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToFloat32(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
  }
}
