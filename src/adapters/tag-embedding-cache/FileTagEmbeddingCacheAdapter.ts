import type { TagEmbeddingCachePort, TagEmbeddingCacheMeta } from '../../application/ports/TagEmbeddingCachePort';
import type { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { TAG_EMBEDDINGS_PATH } from '../../constants';

const SCHEMA_VERSION = 1;

interface StoredTagEntry {
  tag: string;
  vector: string;
}

interface StoredData {
  meta: TagEmbeddingCacheMeta;
  entries: StoredTagEntry[];
}

export class FileTagEmbeddingCacheAdapter implements TagEmbeddingCachePort {
  private cache = new Map<string, Float32Array>();
  private meta: TagEmbeddingCacheMeta | null = null;
  private dirty = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly vault: VaultAccessPort) {}

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn);
    this.writeLock = next.then(() => {}, () => {});
    return next;
  }

  async load(): Promise<void> {
    const raw = await this.vault.readFileRaw(TAG_EMBEDDINGS_PATH);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as StoredData;
      if (!data.meta || !Array.isArray(data.entries)) return;

      this.meta = data.meta;
      this.cache.clear();
      for (const entry of data.entries) {
        this.cache.set(entry.tag, this.base64ToFloat32(entry.vector));
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

      const entries: StoredTagEntry[] = [];
      for (const [tag, vector] of this.cache) {
        entries.push({ tag, vector: this.float32ToBase64(vector) });
      }

      const data: StoredData = { meta: this.meta, entries };
      await this.vault.writeFileRaw(TAG_EMBEDDINGS_PATH, JSON.stringify(data));
      this.dirty = false;
    });
  }

  get(tag: string): Float32Array | undefined {
    return this.cache.get(tag);
  }

  getMany(tags: ReadonlyArray<string>): Map<string, Float32Array> {
    const result = new Map<string, Float32Array>();
    for (const tag of tags) {
      const vec = this.cache.get(tag);
      if (vec) result.set(tag, vec);
    }
    return result;
  }

  put(tag: string, vector: Float32Array): void {
    this.cache.set(tag, vector);
    this.dirty = true;
  }

  putMany(entries: ReadonlyArray<{ tag: string; vector: Float32Array }>): void {
    for (const entry of entries) {
      this.cache.set(entry.tag, entry.vector);
    }
    if (entries.length > 0) this.dirty = true;
  }

  delete(tag: string): void {
    if (this.cache.delete(tag)) {
      this.dirty = true;
    }
  }

  retainOnly(validTags: ReadonlyArray<string>): void {
    const validSet = new Set(validTags);
    for (const tag of this.cache.keys()) {
      if (!validSet.has(tag)) {
        this.cache.delete(tag);
        this.dirty = true;
      }
    }
  }

  getMeta(): TagEmbeddingCacheMeta | null {
    return this.meta;
  }

  setMeta(meta: Pick<TagEmbeddingCacheMeta, 'provider' | 'dimension'> & { model?: string }): void {
    this.meta = { ...meta, version: SCHEMA_VERSION };
    this.dirty = true;
  }

  isCompatible(provider: string, dimension: number, model?: string): boolean {
    if (!this.meta) return false;
    if (this.meta.provider !== provider || this.meta.dimension !== dimension) return false;
    if (model !== undefined && this.meta.model !== model) return false;
    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.meta = null;
    this.dirty = false;
    await this.vault.writeFileRaw(TAG_EMBEDDINGS_PATH, JSON.stringify({ meta: null, entries: [] }));
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
