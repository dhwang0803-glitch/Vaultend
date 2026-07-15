import { VectorStorePort, VectorSearchResult } from '../../application/ports/VectorStorePort';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { EMBEDDINGS_PATH } from '../../constants';
const SCHEMA_VERSION = 1;

interface StoredEntry {
  notePath: string;
  chunkIndex: number;
  vector: string; // base64-encoded Float32Array
}

export interface VectorStoreMeta {
  readonly provider: string;
  readonly dimension: number;
  readonly version: number;
}

interface StoredData {
  meta: VectorStoreMeta;
  entries: StoredEntry[];
}

export class JsonVectorStoreAdapter implements VectorStorePort {
  private entries: Map<string, { notePath: NotePath; chunkIndex: number; vector: Float32Array }> = new Map();
  private dirty = false;
  private meta: VectorStoreMeta | null = null;

  constructor(private readonly vault: VaultAccessPort) {}

  async upsert(notePath: NotePath, chunkIndex: number, vector: Float32Array): Promise<void> {
    const key = `${notePath as string}::${chunkIndex}`;
    this.entries.set(key, { notePath, chunkIndex, vector });
    this.dirty = true;
  }

  async remove(notePath: NotePath): Promise<void> {
    const prefix = `${notePath as string}::`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
    this.dirty = true;
  }

  async search(queryVector: Float32Array, topK: number): Promise<ReadonlyArray<VectorSearchResult>> {
    const results: Array<{ notePath: NotePath; chunkIndex: number; similarity: number }> = [];

    for (const [, entry] of this.entries) {
      const sim = this.cosineSimilarity(queryVector, entry.vector);
      results.push({ notePath: entry.notePath, chunkIndex: entry.chunkIndex, similarity: sim });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;

    const stored: StoredEntry[] = [];
    for (const [, entry] of this.entries) {
      stored.push({
        notePath: entry.notePath as string,
        chunkIndex: entry.chunkIndex,
        vector: this.float32ToBase64(entry.vector),
      });
    }

    const data: StoredData = {
      meta: this.meta ?? { provider: 'unknown', dimension: 0, version: SCHEMA_VERSION },
      entries: stored,
    };

    await this.vault.writeFileRaw(EMBEDDINGS_PATH, JSON.stringify(data));
    this.dirty = false;
  }

  async load(): Promise<void> {
    const raw = await this.vault.readFileRaw(EMBEDDINGS_PATH);
    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);

      let rawEntries: unknown[];
      let loadedMeta: VectorStoreMeta | null = null;

      if (Array.isArray(parsed)) {
        rawEntries = parsed;
      } else if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as StoredData).entries)) {
        const data = parsed as StoredData;
        rawEntries = data.entries;
        loadedMeta = data.meta ?? null;
      } else {
        return;
      }

      const temp = new Map<string, { notePath: NotePath; chunkIndex: number; vector: Float32Array }>();
      for (const item of rawEntries) {
        if (!this.isStoredEntry(item)) continue;
        const key = `${item.notePath}::${item.chunkIndex}`;
        temp.set(key, {
          notePath: createNotePath(item.notePath),
          chunkIndex: item.chunkIndex,
          vector: this.base64ToFloat32(item.vector),
        });
      }

      this.entries = temp;
      this.meta = loadedMeta;
    } catch {
      // Corrupted — keep existing state
    }
  }

  isEmpty(): boolean {
    return this.entries.size === 0;
  }

  getMeta(): VectorStoreMeta | null {
    return this.meta;
  }

  setMeta(meta: Pick<VectorStoreMeta, 'provider' | 'dimension'>): void {
    this.meta = { ...meta, version: SCHEMA_VERSION };
    this.dirty = true;
  }

  isCompatible(provider: string, dimension: number): boolean {
    if (!this.meta) return false;
    return this.meta.provider === provider && this.meta.dimension === dimension;
  }

  async clearEntries(): Promise<void> {
    this.entries.clear();
    this.dirty = true;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.meta = null;
    this.dirty = true;
    await this.flush();
  }

  private isStoredEntry(v: unknown): v is StoredEntry {
    if (v === null || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o.notePath === 'string' && typeof o.chunkIndex === 'number' && typeof o.vector === 'string';
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
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
