import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileNoteEmbeddingCacheAdapter } from '../FileNoteEmbeddingCacheAdapter';
import { createMockVault } from '../../../test-utils/mock-ports';
import type { VaultAccessPort } from '../../../application/ports/VaultAccessPort';
import { NotePath } from '../../../domain/values/NotePath';

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

const NOTE_A = 'inbox/note-a.md' as NotePath;
const NOTE_B = 'notes/note-b.md' as NotePath;
const NOTE_C = 'notes/note-c.md' as NotePath;

describe('FileNoteEmbeddingCacheAdapter', () => {
  let vault: VaultAccessPort;
  let adapter: FileNoteEmbeddingCacheAdapter;

  beforeEach(() => {
    vault = createMockVault();
    adapter = new FileNoteEmbeddingCacheAdapter(vault);
  });

  describe('put + get', () => {
    it('stores and retrieves a note embedding', () => {
      adapter.setMeta({ provider: 'openai', dimension: 3, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.put({ notePath: NOTE_A, vector: vec([1, 2, 3]), contentHash: 'abc' });

      const result = adapter.get(NOTE_A);
      expect(result).toBeDefined();
      expect(result!.vector).toEqual(vec([1, 2, 3]));
      expect(result!.contentHash).toBe('abc');
    });

    it('returns undefined for missing note', () => {
      expect(adapter.get(NOTE_A)).toBeUndefined();
    });
  });

  describe('putMany + getMany', () => {
    it('batch stores and retrieves', () => {
      adapter.setMeta({ provider: 'openai', dimension: 2, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.putMany([
        { notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'h1' },
        { notePath: NOTE_B, vector: vec([0, 1]), contentHash: 'h2' },
      ]);

      const result = adapter.getMany([NOTE_A, NOTE_B, NOTE_C]);
      expect(result.size).toBe(2);
      expect(result.get(NOTE_A)!.contentHash).toBe('h1');
      expect(result.has(NOTE_C)).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all cached entries', () => {
      adapter.putMany([
        { notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'h1' },
        { notePath: NOTE_B, vector: vec([0, 1]), contentHash: 'h2' },
      ]);

      const all = adapter.getAll();
      expect(all.size).toBe(2);
    });
  });

  describe('needsUpdate', () => {
    it('returns true for missing note', () => {
      expect(adapter.needsUpdate(NOTE_A, 'hash123')).toBe(true);
    });

    it('returns true when hash differs', () => {
      adapter.put({ notePath: NOTE_A, vector: vec([1]), contentHash: 'old' });
      expect(adapter.needsUpdate(NOTE_A, 'new')).toBe(true);
    });

    it('returns false when hash matches', () => {
      adapter.put({ notePath: NOTE_A, vector: vec([1]), contentHash: 'same' });
      expect(adapter.needsUpdate(NOTE_A, 'same')).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes a note entry', () => {
      adapter.put({ notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'h' });
      adapter.delete(NOTE_A);
      expect(adapter.get(NOTE_A)).toBeUndefined();
      expect(adapter.size()).toBe(0);
    });
  });

  describe('retainOnly', () => {
    it('removes notes not in the valid set', () => {
      adapter.putMany([
        { notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'h1' },
        { notePath: NOTE_B, vector: vec([0, 1]), contentHash: 'h2' },
        { notePath: NOTE_C, vector: vec([1, 1]), contentHash: 'h3' },
      ]);

      adapter.retainOnly([NOTE_A, NOTE_B]);

      expect(adapter.get(NOTE_A)).toBeDefined();
      expect(adapter.get(NOTE_B)).toBeDefined();
      expect(adapter.get(NOTE_C)).toBeUndefined();
      expect(adapter.size()).toBe(2);
    });
  });

  describe('flush', () => {
    it('skips write when not dirty', async () => {
      await adapter.flush();
      expect(vault.writeFileRaw).not.toHaveBeenCalled();
    });

    it('skips write when no meta set', async () => {
      adapter.put({ notePath: NOTE_A, vector: vec([1]), contentHash: 'h' });
      await adapter.flush();
      expect(vault.writeFileRaw).not.toHaveBeenCalled();
    });

    it('writes when dirty with meta', async () => {
      adapter.setMeta({ provider: 'openai', dimension: 2, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.put({ notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'hash1' });
      await adapter.flush();

      expect(vault.writeFileRaw).toHaveBeenCalledOnce();
      const [path, content] = vi.mocked(vault.writeFileRaw).mock.calls[0];
      expect(path).toBe('.vaultend/note-embeddings.json');

      const parsed = JSON.parse(content);
      expect(parsed.meta.provider).toBe('openai');
      expect(parsed.meta.titleWeight).toBe(0.2);
      expect(parsed.meta.bodyWeight).toBe(0.8);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].notePath).toBe('inbox/note-a.md');
      expect(parsed.entries[0].contentHash).toBe('hash1');
    });

    it('clears dirty flag after write', async () => {
      adapter.setMeta({ provider: 'openai', dimension: 2, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.put({ notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'h' });
      await adapter.flush();
      vi.mocked(vault.writeFileRaw).mockClear();

      await adapter.flush();
      expect(vault.writeFileRaw).not.toHaveBeenCalled();
    });
  });

  describe('load + roundtrip', () => {
    it('loads previously flushed data', async () => {
      adapter.setMeta({ provider: 'gemini', dimension: 3, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.putMany([
        { notePath: NOTE_A, vector: vec([0.5, 1.0, -0.3]), contentHash: 'abc' },
        { notePath: NOTE_B, vector: vec([1.0, 0.0, 0.7]), contentHash: 'def' },
      ]);
      await adapter.flush();

      const savedContent = vi.mocked(vault.writeFileRaw).mock.calls[0][1];

      const adapter2 = new FileNoteEmbeddingCacheAdapter(
        createMockVault({ readFileRaw: vi.fn().mockResolvedValue(savedContent) }),
      );
      await adapter2.load();

      expect(adapter2.size()).toBe(2);
      expect(adapter2.getMeta()?.provider).toBe('gemini');
      expect(adapter2.getMeta()?.titleWeight).toBe(0.2);

      const entry = adapter2.get(NOTE_A);
      expect(entry).toBeDefined();
      expect(entry!.vector[0]).toBeCloseTo(0.5);
      expect(entry!.contentHash).toBe('abc');
    });
  });

  describe('load graceful degradation', () => {
    it('handles missing file', async () => {
      vi.mocked(vault.readFileRaw).mockResolvedValue(null);
      await adapter.load();
      expect(adapter.size()).toBe(0);
      expect(adapter.getMeta()).toBeNull();
    });

    it('handles corrupt JSON', async () => {
      vi.mocked(vault.readFileRaw).mockResolvedValue('not json {{{');
      await adapter.load();
      expect(adapter.size()).toBe(0);
    });

    it('handles missing entries array', async () => {
      vi.mocked(vault.readFileRaw).mockResolvedValue(
        '{"meta": {"provider":"x","dimension":1,"titleWeight":0.2,"bodyWeight":0.8,"version":1}}',
      );
      await adapter.load();
      expect(adapter.size()).toBe(0);
    });
  });

  describe('isCompatible', () => {
    it('returns false when no meta', () => {
      expect(adapter.isCompatible('openai', 1536, 0.2, 0.8)).toBe(false);
    });

    it('returns true for matching all fields', () => {
      adapter.setMeta({ provider: 'openai', dimension: 1536, titleWeight: 0.2, bodyWeight: 0.8 });
      expect(adapter.isCompatible('openai', 1536, 0.2, 0.8)).toBe(true);
    });

    it('returns false for different provider', () => {
      adapter.setMeta({ provider: 'openai', dimension: 1536, titleWeight: 0.2, bodyWeight: 0.8 });
      expect(adapter.isCompatible('gemini', 1536, 0.2, 0.8)).toBe(false);
    });

    it('returns false for different weights', () => {
      adapter.setMeta({ provider: 'openai', dimension: 1536, titleWeight: 0.2, bodyWeight: 0.8 });
      expect(adapter.isCompatible('openai', 1536, 0.3, 0.7)).toBe(false);
    });

    it('checks model when specified', () => {
      adapter.setMeta({ provider: 'openai', dimension: 1536, titleWeight: 0.2, bodyWeight: 0.8, model: 'emb-3-small' });
      expect(adapter.isCompatible('openai', 1536, 0.2, 0.8, 'emb-3-small')).toBe(true);
      expect(adapter.isCompatible('openai', 1536, 0.2, 0.8, 'emb-3-large')).toBe(false);
    });
  });

  describe('clear', () => {
    it('resets all state and writes empty file', async () => {
      adapter.setMeta({ provider: 'openai', dimension: 2, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.put({ notePath: NOTE_A, vector: vec([1, 0]), contentHash: 'h' });
      await adapter.clear();

      expect(adapter.size()).toBe(0);
      expect(adapter.getMeta()).toBeNull();
      expect(vault.writeFileRaw).toHaveBeenCalled();
    });
  });

  describe('serialized writes', () => {
    it('concurrent flushes coalesce', async () => {
      adapter.setMeta({ provider: 'openai', dimension: 1, titleWeight: 0.2, bodyWeight: 0.8 });
      adapter.put({ notePath: NOTE_A, vector: vec([1]), contentHash: 'h1' });
      const p1 = adapter.flush();

      adapter.put({ notePath: NOTE_B, vector: vec([2]), contentHash: 'h2' });
      const p2 = adapter.flush();

      await Promise.all([p1, p2]);

      expect(vault.writeFileRaw).toHaveBeenCalledTimes(1);
      const written = JSON.parse(vi.mocked(vault.writeFileRaw).mock.calls[0][1]);
      expect(written.entries).toHaveLength(2);
    });
  });
});
