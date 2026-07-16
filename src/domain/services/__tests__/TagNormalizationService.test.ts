import { describe, it, expect } from 'vitest';
import { TagNormalizationService, CanonicalTagGroup } from '../TagNormalizationService';

describe('TagNormalizationService', () => {
  describe('normalizeForComparison', () => {
    it('strips # prefix and lowercases', () => {
      expect(TagNormalizationService.normalizeForComparison('#GameDev')).toBe('gamedev');
    });

    it('removes hyphens, underscores, plus signs', () => {
      expect(TagNormalizationService.normalizeForComparison('#vampire-shaman')).toBe('vampireshaman');
      expect(TagNormalizationService.normalizeForComparison('#vampire_shaman')).toBe('vampireshaman');
      expect(TagNormalizationService.normalizeForComparison('#vampire+shaman')).toBe('vampireshaman');
    });

    it('preserves Korean characters', () => {
      expect(TagNormalizationService.normalizeForComparison('#뱀파이어-샤먼')).toBe('뱀파이어샤먼');
    });

    it('preserves digits', () => {
      expect(TagNormalizationService.normalizeForComparison('#web3-dev')).toBe('web3dev');
    });

    it('handles mixed Korean and English', () => {
      expect(TagNormalizationService.normalizeForComparison('#게임-dev')).toBe('게임dev');
    });

    it('removes slashes (hierarchical tags)', () => {
      expect(TagNormalizationService.normalizeForComparison('#dev/frontend')).toBe('devfrontend');
    });

    it('returns empty string for tag with only special chars', () => {
      expect(TagNormalizationService.normalizeForComparison('#---')).toBe('');
    });

    it('works without # prefix', () => {
      expect(TagNormalizationService.normalizeForComparison('game-dev')).toBe('gamedev');
    });
  });

  describe('buildCanonicalIndex', () => {
    it('groups tags with same canonical key', () => {
      const tags = [
        { tag: '#vampire-shaman', count: 5 },
        { tag: '#Vampire_Shaman', count: 3 },
        { tag: '#vampire+shaman', count: 1 },
      ];
      const index = TagNormalizationService.buildCanonicalIndex(tags);
      expect(index).toHaveLength(1);
      expect(index[0].canonical).toBe('#vampire-shaman');
      expect(index[0].canonicalKey).toBe('vampireshaman');
      expect(index[0].variants).toHaveLength(3);
    });

    it('selects highest frequency as canonical', () => {
      const tags = [
        { tag: '#game_dev', count: 2 },
        { tag: '#Game-Dev', count: 10 },
      ];
      const index = TagNormalizationService.buildCanonicalIndex(tags);
      expect(index[0].canonical).toBe('#Game-Dev');
    });

    it('keeps distinct tags in separate groups', () => {
      const tags = [
        { tag: '#game', count: 5 },
        { tag: '#rpg', count: 3 },
        { tag: '#dev', count: 1 },
      ];
      const index = TagNormalizationService.buildCanonicalIndex(tags);
      expect(index).toHaveLength(3);
    });

    it('skips tags that normalize to empty string', () => {
      const tags = [
        { tag: '#---', count: 1 },
        { tag: '#game', count: 5 },
      ];
      const index = TagNormalizationService.buildCanonicalIndex(tags);
      expect(index).toHaveLength(1);
      expect(index[0].canonical).toBe('#game');
    });

    it('handles Korean variant grouping', () => {
      const tags = [
        { tag: '#뱀파이어-샤먼', count: 4 },
        { tag: '#뱀파이어+샤먼', count: 2 },
      ];
      const index = TagNormalizationService.buildCanonicalIndex(tags);
      expect(index).toHaveLength(1);
      expect(index[0].canonical).toBe('#뱀파이어-샤먼');
    });
  });

  describe('resolveToCanonical', () => {
    const index: CanonicalTagGroup[] = [
      {
        canonical: '#vampire-shaman',
        canonicalKey: 'vampireshaman',
        variants: [
          { tag: '#vampire-shaman', count: 5 },
          { tag: '#Vampire_Shaman', count: 2 },
        ],
      },
      {
        canonical: '#game-dev',
        canonicalKey: 'gamedev',
        variants: [{ tag: '#game-dev', count: 3 }],
      },
    ];

    it('resolves variant to canonical form', () => {
      expect(TagNormalizationService.resolveToCanonical('#vampire+shaman', index))
        .toBe('#vampire-shaman');
    });

    it('resolves case-insensitive variant', () => {
      expect(TagNormalizationService.resolveToCanonical('#VAMPIRE_SHAMAN', index))
        .toBe('#vampire-shaman');
    });

    it('returns original if no match found', () => {
      expect(TagNormalizationService.resolveToCanonical('#unknown-tag', index))
        .toBe('#unknown-tag');
    });

    it('resolves exact canonical to itself', () => {
      expect(TagNormalizationService.resolveToCanonical('#game-dev', index))
        .toBe('#game-dev');
    });
  });

  describe('mergeSessionTags', () => {
    const baseIndex: CanonicalTagGroup[] = [
      {
        canonical: '#game',
        canonicalKey: 'game',
        variants: [{ tag: '#game', count: 10 }],
      },
    ];

    it('adds new session tag as new group', () => {
      const merged = TagNormalizationService.mergeSessionTags(baseIndex, ['#rpg']);
      expect(merged).toHaveLength(2);
      expect(merged[1].canonical).toBe('#rpg');
      expect(merged[1].variants[0].count).toBe(1);
    });

    it('skips session tag that matches existing canonical key', () => {
      const merged = TagNormalizationService.mergeSessionTags(baseIndex, ['#Game']);
      expect(merged).toHaveLength(1);
    });

    it('deduplicates session tags among themselves', () => {
      const merged = TagNormalizationService.mergeSessionTags(baseIndex, ['#rpg', '#RPG']);
      expect(merged).toHaveLength(2);
    });

    it('preserves original index immutably', () => {
      const merged = TagNormalizationService.mergeSessionTags(baseIndex, ['#rpg']);
      expect(baseIndex).toHaveLength(1);
      expect(merged).toHaveLength(2);
    });

    it('skips empty-normalizing session tags', () => {
      const merged = TagNormalizationService.mergeSessionTags(baseIndex, ['#---']);
      expect(merged).toHaveLength(1);
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(TagNormalizationService.cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(TagNormalizationService.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('returns 0 for empty vectors', () => {
      expect(TagNormalizationService.cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for zero vector', () => {
      expect(TagNormalizationService.cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it('handles mismatched lengths', () => {
      expect(TagNormalizationService.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('computes correct similarity for known vectors', () => {
      const a = [1, 1, 0];
      const b = [1, 0, 1];
      const expected = 1 / (Math.sqrt(2) * Math.sqrt(2));
      expect(TagNormalizationService.cosineSimilarity(a, b)).toBeCloseTo(expected);
    });

    it('works with Float32Array', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);
      expect(TagNormalizationService.cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });
  });
});
