import { describe, it, expect } from 'vitest';
import { parseLinkSelectionResponse } from '../parseLinkSelectionResponse';
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

  it('parses valid JSON with correct mappings', () => {
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
});
