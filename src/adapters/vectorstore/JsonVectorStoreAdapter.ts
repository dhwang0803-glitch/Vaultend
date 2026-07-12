import { VectorStorePort, VectorSearchResult } from '../../application/ports/VectorStorePort';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';

const EMBEDDINGS_PATH = '.knowledge-maintenance/embeddings.json';

interface StoredEntry {
  notePath: string;
  chunkIndex: number;
  vector: string; // base64-encoded Float32Array
}

export class JsonVectorStoreAdapter implements VectorStorePort {
  private entries: Map<string, { notePath: NotePath; chunkIndex: number; vector: Float32Array }> = new Map();
  private dirty = false;

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

    await this.vault.writeFileRaw(EMBEDDINGS_PATH, JSON.stringify(stored));
    this.dirty = false;
  }

  async load(): Promise<void> {
    const raw = await this.vault.readFileRaw(EMBEDDINGS_PATH);
    if (!raw) return;

    try {
      const stored: StoredEntry[] = JSON.parse(raw);
      this.entries.clear();
      for (const item of stored) {
        const key = `${item.notePath}::${item.chunkIndex}`;
        this.entries.set(key, {
          notePath: createNotePath(item.notePath),
          chunkIndex: item.chunkIndex,
          vector: this.base64ToFloat32(item.vector),
        });
      }
    } catch {
      // Corrupted — start fresh
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.dirty = true;
    await this.flush();
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
