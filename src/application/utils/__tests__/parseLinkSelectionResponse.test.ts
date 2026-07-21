import { describe, it, expect } from 'vitest';
import { parseLinkSelectionResponse, DEFAULT_LINK_RELEVANCE_THRESHOLD } from '../parseLinkSelectionResponse';
import { NotePath } from '../../../domain/values/NotePath';

function np(s: string): NotePath { return s as NotePath; }

describe('parseLinkSelectionResponse', () => {
  const noteIndex = new Map<number, NotePath>([
    [1, np('note-a.md')],
    [2, np('note-b.md')],
    [3, np('note-c.md')],
    [4, np('note-d.md')],
    [5, np('note-e.md')],
    [6, np('note-f.md')],
    [7, np('note-g.md')],
  ]);

  const targetIndex = new Map<number, NotePath>([
    [1, np('note-a.md')],
    [3, np('note-c.md')],
  ]);

  // --- Legacy format (plain number arrays) ---

  it('parses legacy format with correct mappings', () => {
    const json = '{"links": {"1": [2, 4], "3": [5, 7]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.size).toBe(2);
    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md'), np('note-d.md')]);
    expect(result.get(np('note-c.md'))).toEqual([np('note-e.md'), np('note-g.md')]);
  });

  it('returns empty map on invalid JSON', () => {
    const result = parseLinkSelectionResponse('not json at all', noteIndex, targetIndex);
    expect(result.size).toBe(0);
  });

  it('ignores out-of-range note indices', () => {
    const json = '{"links": {"1": [2, 99, 4]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md'), np('note-d.md')]);
  });

  it('ignores unknown target indices', () => {
    const json = '{"links": {"1": [2], "99": [3]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.size).toBe(1);
    expect(result.has(np('note-a.md'))).toBe(true);
  });

  it('removes self-references', () => {
    const json = '{"links": {"1": [1, 2]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md')]);
  });

  it('limits to 5 links per target', () => {
    const json = '{"links": {"1": [2, 3, 4, 5, 6, 7]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))!.length).toBe(5);
  });

  it('removes duplicate note indices', () => {
    const json = '{"links": {"1": [2, 2, 3]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md'), np('note-c.md')]);
  });

  it('handles code-block wrapped JSON', () => {
    const json = '```json\n{"links": {"1": [2]}}\n```';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md')]);
  });

  it('returns empty map when links key is missing', () => {
    const json = '{"other": "data"}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.size).toBe(0);
  });

  it('skips targets with no valid links', () => {
    const json = '{"links": {"1": [99], "3": [5]}}';
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.size).toBe(1);
    expect(result.has(np('note-a.md'))).toBe(false);
    expect(result.get(np('note-c.md'))).toEqual([np('note-e.md')]);
  });

  // --- Scored format (objects with note/score/reason) ---

  it('parses scored format and keeps entries above threshold', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 9, reason: 'same domain' },
          { note: 4, score: 8, reason: 'complementary' },
        ],
        '3': [
          { note: 5, score: 7, reason: 'reference value' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.size).toBe(2);
    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md'), np('note-d.md')]);
    expect(result.get(np('note-c.md'))).toEqual([np('note-e.md')]);
  });

  it('filters out scored entries below default threshold', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 9, reason: 'strong match' },
          { note: 4, score: 5, reason: 'weak match' },
          { note: 5, score: 3, reason: 'noise' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md')]);
  });

  it('drops target entirely when all entries are below threshold', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 4, reason: 'meta-category only' },
          { note: 3, score: 3, reason: 'keyword overlap' },
        ],
        '3': [
          { note: 5, score: 8, reason: 'strong match' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.size).toBe(1);
    expect(result.has(np('note-a.md'))).toBe(false);
    expect(result.get(np('note-c.md'))).toEqual([np('note-e.md')]);
  });

  it('respects custom minScore parameter', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 9, reason: 'strong' },
          { note: 4, score: 8, reason: 'good' },
          { note: 5, score: 7, reason: 'ok' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex, 8);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md'), np('note-d.md')]);
  });

  it('handles mixed legacy and scored entries in same array', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 9, reason: 'strong' },
          4,
          { note: 5, score: 3, reason: 'noise' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md'), np('note-d.md')]);
  });

  it('exports default threshold constant', () => {
    expect(DEFAULT_LINK_RELEVANCE_THRESHOLD).toBe(7);
  });

  it('handles scored entries with missing reason gracefully', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 8 },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md')]);
  });

  it('removes self-references in scored format', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 1, score: 10, reason: 'self' },
          { note: 2, score: 8, reason: 'real link' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))).toEqual([np('note-b.md')]);
  });

  it('limits scored entries to 5 per target', () => {
    const json = JSON.stringify({
      links: {
        '1': [
          { note: 2, score: 10, reason: 'a' },
          { note: 3, score: 10, reason: 'b' },
          { note: 4, score: 10, reason: 'c' },
          { note: 5, score: 10, reason: 'd' },
          { note: 6, score: 10, reason: 'e' },
          { note: 7, score: 10, reason: 'f' },
        ],
      },
    });
    const result = parseLinkSelectionResponse(json, noteIndex, targetIndex);

    expect(result.get(np('note-a.md'))!.length).toBe(5);
  });
});
