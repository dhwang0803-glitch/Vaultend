import { describe, it, expect } from 'vitest';
import { parseBatchSummaryResponse } from '../parseBatchSummaryResponse';
import { createNotePath } from '../../../domain/values/NotePath';

describe('parseBatchSummaryResponse', () => {
  const makeMap = (entries: Array<[number, string]>) => {
    const map = new Map<number, ReturnType<typeof createNotePath>>();
    for (const [idx, path] of entries) {
      map.set(idx, createNotePath(path));
    }
    return map;
  };

  it('parses valid JSON with summaries', () => {
    const json = '{"summaries": {"1": "Clean Architecture principles", "2": "React hooks guide"}}';
    const noteMap = makeMap([[1, 'notes/arch.md'], [2, 'notes/react.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(2);
    expect(result[0].notePath).toBe(createNotePath('notes/arch.md'));
    expect(result[0].onelineSummary).toBe('Clean Architecture principles');
    expect(result[1].onelineSummary).toBe('React hooks guide');
  });

  it('returns empty array on null/undefined input', () => {
    const noteMap = makeMap([[1, 'notes/a.md']]);
    expect(parseBatchSummaryResponse(null, noteMap).length).toBe(0);
    expect(parseBatchSummaryResponse(undefined, noteMap).length).toBe(0);
  });

  it('returns empty array on invalid JSON', () => {
    const noteMap = makeMap([[1, 'notes/a.md']]);
    expect(parseBatchSummaryResponse('not json', noteMap).length).toBe(0);
  });

  it('handles code-block wrapped JSON', () => {
    const json = '```json\n{"summaries": {"1": "summary one"}}\n```';
    const noteMap = makeMap([[1, 'notes/a.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(1);
    expect(result[0].onelineSummary).toBe('summary one');
  });

  it('ignores non-numeric keys', () => {
    const json = '{"summaries": {"abc": "ignored", "1": "valid"}}';
    const noteMap = makeMap([[1, 'notes/a.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(1);
    expect(result[0].onelineSummary).toBe('valid');
  });

  it('skips indices not in noteMap', () => {
    const json = '{"summaries": {"1": "exists", "99": "missing"}}';
    const noteMap = makeMap([[1, 'notes/a.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(1);
  });

  it('skips empty summary strings', () => {
    const json = '{"summaries": {"1": "", "2": "valid summary"}}';
    const noteMap = makeMap([[1, 'notes/a.md'], [2, 'notes/b.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(1);
    expect(result[0].notePath).toBe(createNotePath('notes/b.md'));
  });

  it('returns empty array when summaries key is missing', () => {
    const json = '{"other": "data"}';
    const noteMap = makeMap([[1, 'notes/a.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(0);
  });

  it('trims whitespace from summaries', () => {
    const json = '{"summaries": {"1": "  padded summary  "}}';
    const noteMap = makeMap([[1, 'notes/a.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result[0].onelineSummary).toBe('padded summary');
  });

  it('skips non-string values', () => {
    const json = '{"summaries": {"1": 123, "2": "valid"}}';
    const noteMap = makeMap([[1, 'notes/a.md'], [2, 'notes/b.md']]);
    const result = parseBatchSummaryResponse(json, noteMap);

    expect(result.length).toBe(1);
    expect(result[0].notePath).toBe(createNotePath('notes/b.md'));
  });
});
