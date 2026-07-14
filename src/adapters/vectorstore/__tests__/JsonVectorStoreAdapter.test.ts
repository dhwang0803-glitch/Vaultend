import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonVectorStoreAdapter } from '../JsonVectorStoreAdapter';
import { createNotePath } from '../../../domain/values/NotePath';

describe('JsonVectorStoreAdapter', () => {
  let adapter: JsonVectorStoreAdapter;
  let mockVault: { readFileRaw: ReturnType<typeof vi.fn>; writeFileRaw: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockVault = {
      readFileRaw: vi.fn().mockResolvedValue(null),
      writeFileRaw: vi.fn().mockResolvedValue(undefined),
    };
    adapter = new JsonVectorStoreAdapter(mockVault as never);
  });

  it('upserts and searches vectors by cosine similarity', async () => {
    const path = createNotePath('notes/test.md');
    const vecA = new Float32Array([1, 0, 0]);
    const vecB = new Float32Array([0, 1, 0]);
    const query = new Float32Array([0.9, 0.1, 0]);

    await adapter.upsert(path, 0, vecA);
    await adapter.upsert(path, 1, vecB);

    const results = await adapter.search(query, 2);
    expect(results.length).toBe(2);
    expect(results[0].chunkIndex).toBe(0); // vecA is closer to query
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('removes all vectors for a note', async () => {
    const path = createNotePath('notes/test.md');
    await adapter.upsert(path, 0, new Float32Array([1, 0]));
    await adapter.upsert(path, 1, new Float32Array([0, 1]));
    await adapter.remove(path);

    const results = await adapter.search(new Float32Array([1, 0]), 5);
    expect(results.length).toBe(0);
  });

  it('persists and loads vectors with metadata', async () => {
    const path = createNotePath('notes/test.md');
    const vec = new Float32Array([0.5, 0.5, 0.5]);
    adapter.setMeta({ provider: 'gemini', dimension: 3 });
    await adapter.upsert(path, 0, vec);
    await adapter.flush();

    expect(mockVault.writeFileRaw).toHaveBeenCalledWith(
      '.vaultend/embeddings.json',
      expect.any(String),
    );

    const savedData = mockVault.writeFileRaw.mock.calls[0][1];
    const parsed = JSON.parse(savedData);
    expect(parsed.meta).toEqual({ provider: 'gemini', dimension: 3, version: 1 });
    expect(parsed.entries).toHaveLength(1);

    // Simulate loading from persisted data
    mockVault.readFileRaw.mockResolvedValue(savedData);

    const freshAdapter = new JsonVectorStoreAdapter(mockVault as never);
    await freshAdapter.load();

    const results = await freshAdapter.search(new Float32Array([0.5, 0.5, 0.5]), 1);
    expect(results.length).toBe(1);
    expect(results[0].similarity).toBeCloseTo(1.0);
    const meta = freshAdapter.getMeta();
    expect(meta?.provider).toBe('gemini');
    expect(meta?.dimension).toBe(3);
    expect(meta?.version).toBe(1);
  });

  it('loads legacy format (plain array without metadata)', async () => {
    const legacyData = JSON.stringify([
      { notePath: 'notes/test.md', chunkIndex: 0, vector: btoa(String.fromCharCode(...new Uint8Array(new Float32Array([1, 0, 0]).buffer))) },
    ]);
    mockVault.readFileRaw.mockResolvedValue(legacyData);

    await adapter.load();
    expect(adapter.getMeta()).toBeNull();
    expect(adapter.isEmpty()).toBe(false);
  });

  it('detects provider/dimension compatibility', async () => {
    adapter.setMeta({ provider: 'gemini', dimension: 768 });
    expect(adapter.isCompatible('gemini', 768)).toBe(true);
    expect(adapter.isCompatible('openai', 768)).toBe(false);
    expect(adapter.isCompatible('gemini', 1536)).toBe(false);
  });

  it('returns incompatible when no metadata exists', () => {
    expect(adapter.isCompatible('gemini', 768)).toBe(false);
  });

  it('clearEntries removes vectors but preserves metadata', async () => {
    adapter.setMeta({ provider: 'gemini', dimension: 2 });
    await adapter.upsert(createNotePath('a.md'), 0, new Float32Array([1, 0]));
    await adapter.clearEntries();
    const results = await adapter.search(new Float32Array([1, 0]), 5);
    expect(results.length).toBe(0);
    expect(adapter.getMeta()?.provider).toBe('gemini');
    expect(adapter.isEmpty()).toBe(true);
  });

  it('clears all vectors and metadata', async () => {
    adapter.setMeta({ provider: 'gemini', dimension: 3 });
    await adapter.upsert(createNotePath('a.md'), 0, new Float32Array([1, 0]));
    await adapter.clear();
    const results = await adapter.search(new Float32Array([1, 0]), 5);
    expect(results.length).toBe(0);
    expect(adapter.getMeta()).toBeNull();
  });
});
