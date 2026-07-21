import { describe, it, expect } from 'vitest';
import { parseTagGroupingResponse } from '../parseTagGroupingResponse';

function buildIndexMap(tags: string[]): Map<number, string> {
  const m = new Map<number, string>();
  tags.forEach((t, i) => m.set(i, t));
  return m;
}

describe('parseTagGroupingResponse', () => {
  const tags = ['#project-management', '#PM', '#software-engineering', '#SWE', '#design'];
  const indexToTag = buildIndexMap(tags);

  it('parses valid index-based response', () => {
    const json = JSON.stringify({
      groups: [
        { canonical: 0, variants: [1], reason: 'PM is abbreviation' },
        { canonical: 2, variants: [3], reason: 'SWE is abbreviation' },
      ],
    });

    const result = parseTagGroupingResponse(json, indexToTag);
    expect(result).toHaveLength(2);
    expect(result[0].canonical).toBe('#project-management');
    expect(result[0].variants).toEqual(['#PM']);
    expect(result[0].reason).toBe('PM is abbreviation');
    expect(result[0].type).toBe('merge');
    expect(result[1].canonical).toBe('#software-engineering');
    expect(result[1].variants).toEqual(['#SWE']);
    expect(result[1].type).toBe('merge');
  });

  it('strips markdown code fences', () => {
    const json = '```json\n' + JSON.stringify({
      groups: [{ canonical: 0, variants: [1] }],
    }) + '\n```';

    const result = parseTagGroupingResponse(json, indexToTag);
    expect(result).toHaveLength(1);
    expect(result[0].canonical).toBe('#project-management');
  });

  it('returns empty for null/undefined input', () => {
    expect(parseTagGroupingResponse(null, indexToTag)).toEqual([]);
    expect(parseTagGroupingResponse(undefined, indexToTag)).toEqual([]);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseTagGroupingResponse('not json at all', indexToTag)).toEqual([]);
  });

  it('ignores hallucinated indices not in the map', () => {
    const json = JSON.stringify({
      groups: [{ canonical: 99, variants: [100] }],
    });
    expect(parseTagGroupingResponse(json, indexToTag)).toEqual([]);
  });

  it('removes canonical from variants to prevent duplication', () => {
    const json = JSON.stringify({
      groups: [{ canonical: 0, variants: [0, 1] }],
    });

    const result = parseTagGroupingResponse(json, indexToTag);
    expect(result).toHaveLength(1);
    expect(result[0].variants).toEqual(['#PM']);
  });

  it('drops groups with zero valid variants', () => {
    const json = JSON.stringify({
      groups: [{ canonical: 4, variants: [] }],
    });
    expect(parseTagGroupingResponse(json, indexToTag)).toEqual([]);
  });

  it('handles string-typed indices gracefully', () => {
    const json = JSON.stringify({
      groups: [{ canonical: '0', variants: ['1'] }],
    });

    const result = parseTagGroupingResponse(json, indexToTag);
    expect(result).toHaveLength(1);
    expect(result[0].canonical).toBe('#project-management');
    expect(result[0].variants).toEqual(['#PM']);
  });

  it('parses nest and relate types', () => {
    const tags2 = ['#sleep', '#sleep-cycle', '#sleep-hygiene', '#vampire-shaman', '#뱀파이어', '#샤먼'];
    const idx2 = buildIndexMap(tags2);
    const json = JSON.stringify({
      groups: [
        { type: 'nest', canonical: 0, variants: [1, 2], reason: 'sub-concepts of sleep' },
        { type: 'relate', canonical: 3, variants: [4, 5], reason: 'compound overlap' },
      ],
    });

    const result = parseTagGroupingResponse(json, idx2);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('nest');
    expect(result[0].canonical).toBe('#sleep');
    expect(result[0].variants).toEqual(['#sleep-cycle', '#sleep-hygiene']);
    expect(result[1].type).toBe('relate');
    expect(result[1].canonical).toBe('#vampire-shaman');
    expect(result[1].variants).toEqual(['#뱀파이어', '#샤먼']);
  });

  it('defaults unknown type to merge', () => {
    const json = JSON.stringify({
      groups: [{ type: 'unknown', canonical: 0, variants: [1] }],
    });

    const result = parseTagGroupingResponse(json, indexToTag);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('merge');
  });
});
