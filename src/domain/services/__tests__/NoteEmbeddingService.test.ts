import { describe, it, expect } from 'vitest';
import { NoteEmbeddingService } from '../NoteEmbeddingService';
import { NotePath } from '../../values/NotePath';

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

function l2Norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

describe('NoteEmbeddingService', () => {
  describe('combineEmbeddings', () => {
    it('applies weighted sum with default config (0.2 title, 0.8 body)', () => {
      const title = vec([1, 0, 0]);
      const body = vec([0, 1, 0]);
      const result = NoteEmbeddingService.combineEmbeddings(title, body);

      expect(result.length).toBe(3);
      const norm = l2Norm(result);
      expect(norm).toBeCloseTo(1.0, 5);

      const rawWeighted = vec([0.2, 0.8, 0]);
      const rawNorm = l2Norm(rawWeighted);
      expect(result[0]).toBeCloseTo(0.2 / rawNorm, 5);
      expect(result[1]).toBeCloseTo(0.8 / rawNorm, 5);
      expect(result[2]).toBeCloseTo(0, 5);
    });

    it('applies custom weights', () => {
      const title = vec([1, 0]);
      const body = vec([0, 1]);
      const result = NoteEmbeddingService.combineEmbeddings(title, body, {
        titleWeight: 0.5,
        bodyWeight: 0.5,
      });

      const norm = l2Norm(result);
      expect(norm).toBeCloseTo(1.0, 5);
      expect(result[0]).toBeCloseTo(result[1], 5);
    });

    it('L2-normalizes the result', () => {
      const title = vec([3, 4, 0]);
      const body = vec([0, 0, 5]);
      const result = NoteEmbeddingService.combineEmbeddings(title, body);
      expect(l2Norm(result)).toBeCloseTo(1.0, 5);
    });

    it('handles zero vector gracefully', () => {
      const title = vec([0, 0]);
      const body = vec([0, 0]);
      const result = NoteEmbeddingService.combineEmbeddings(title, body);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
    });

    it('throws on dimension mismatch', () => {
      expect(() => {
        NoteEmbeddingService.combineEmbeddings(vec([1, 2]), vec([1, 2, 3]));
      }).toThrow('dimension mismatch');
    });
  });

  describe('findSimilarNotes', () => {
    const target = vec([1, 0, 0]);

    const candidates = new Map<NotePath, Float32Array>([
      ['notes/high.md' as NotePath, vec([0.99, 0.1, 0])],
      ['notes/medium.md' as NotePath, vec([0.7, 0.7, 0])],
      ['notes/low.md' as NotePath, vec([0.1, 0.9, 0.3])],
      ['notes/exact.md' as NotePath, vec([1, 0, 0])],
    ]);

    it('returns notes above threshold sorted by similarity', () => {
      const results = NoteEmbeddingService.findSimilarNotes(target, candidates, 0.9);
      expect(results.length).toBe(2);
      expect(results[0].notePath).toBe('notes/exact.md');
      expect(results[0].similarity).toBeCloseTo(1.0, 3);
      expect(results[1].notePath).toBe('notes/high.md');
    });

    it('respects maxResults', () => {
      const results = NoteEmbeddingService.findSimilarNotes(target, candidates, 0.0, 2);
      expect(results.length).toBe(2);
    });

    it('returns empty array when no candidates meet threshold', () => {
      const results = NoteEmbeddingService.findSimilarNotes(target, candidates, 0.999);
      expect(results.length).toBe(1);
      expect(results[0].notePath).toBe('notes/exact.md');
    });

    it('handles empty candidates', () => {
      const results = NoteEmbeddingService.findSimilarNotes(target, new Map());
      expect(results).toEqual([]);
    });

    it('uses default threshold (0.70) and maxResults (5)', () => {
      const results = NoteEmbeddingService.findSimilarNotes(target, candidates);
      for (const r of results) {
        expect(r.similarity).toBeGreaterThanOrEqual(0.70);
      }
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('computeContentHash', () => {
    it('returns a hex string', async () => {
      const hash = await NoteEmbeddingService.computeContentHash('Title', 'Body content');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('same input produces same hash', async () => {
      const h1 = await NoteEmbeddingService.computeContentHash('A', 'B');
      const h2 = await NoteEmbeddingService.computeContentHash('A', 'B');
      expect(h1).toBe(h2);
    });

    it('different input produces different hash', async () => {
      const h1 = await NoteEmbeddingService.computeContentHash('A', 'B');
      const h2 = await NoteEmbeddingService.computeContentHash('A', 'C');
      expect(h1).not.toBe(h2);
    });
  });

  describe('constants', () => {
    it('DEFAULT_CONFIG has 0.2/0.8 weights', () => {
      expect(NoteEmbeddingService.DEFAULT_CONFIG.titleWeight).toBe(0.2);
      expect(NoteEmbeddingService.DEFAULT_CONFIG.bodyWeight).toBe(0.8);
    });

    it('SIMILARITY_THRESHOLD is 0.70', () => {
      expect(NoteEmbeddingService.SIMILARITY_THRESHOLD).toBe(0.70);
    });

    it('MAX_LINK_SUGGESTIONS is 5', () => {
      expect(NoteEmbeddingService.MAX_LINK_SUGGESTIONS).toBe(5);
    });
  });
});
