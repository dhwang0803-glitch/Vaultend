import { describe, it, expect } from 'vitest';
import { SummaryIndexService } from '../SummaryIndexService';
import { createNotePath } from '../../values/NotePath';

describe('SummaryIndexService', () => {
  describe('buildBatchItems', () => {
    it('builds items with 1-based indices', () => {
      const notes = [
        { notePath: createNotePath('notes/a.md'), title: 'Note A', content: 'body A content' },
        { notePath: createNotePath('notes/b.md'), title: 'Note B', content: 'body B content' },
      ];
      const items = SummaryIndexService.buildBatchItems(notes);

      expect(items.length).toBe(2);
      expect(items[0].index).toBe(1);
      expect(items[0].title).toBe('Note A');
      expect(items[0].contentExcerpt).toBe('body A content');
      expect(items[1].index).toBe(2);
    });

    it('strips frontmatter from content', () => {
      const notes = [
        {
          notePath: createNotePath('notes/a.md'),
          title: 'A',
          content: '---\ntags: [test]\n---\nActual body here',
        },
      ];
      const items = SummaryIndexService.buildBatchItems(notes);

      expect(items[0].contentExcerpt).toBe('Actual body here');
    });

    it('truncates content to CONTENT_EXCERPT_LENGTH', () => {
      const longContent = 'x'.repeat(1000);
      const notes = [
        { notePath: createNotePath('notes/a.md'), title: 'A', content: longContent },
      ];
      const items = SummaryIndexService.buildBatchItems(notes);

      expect(items[0].contentExcerpt.length).toBe(SummaryIndexService.CONTENT_EXCERPT_LENGTH);
    });

    it('handles empty content', () => {
      const notes = [
        { notePath: createNotePath('notes/a.md'), title: 'A', content: '' },
      ];
      const items = SummaryIndexService.buildBatchItems(notes);

      expect(items[0].contentExcerpt).toBe('');
    });

    it('handles content that is only frontmatter', () => {
      const notes = [
        { notePath: createNotePath('notes/a.md'), title: 'A', content: '---\ntags: [test]\n---\n' },
      ];
      const items = SummaryIndexService.buildBatchItems(notes);

      expect(items[0].contentExcerpt).toBe('');
    });
  });

  describe('parseBatchSummaryResponse', () => {
    const items = [
      { index: 1, notePath: createNotePath('notes/a.md'), title: 'A', contentExcerpt: '' },
      { index: 2, notePath: createNotePath('notes/b.md'), title: 'B', contentExcerpt: '' },
    ];

    it('parses valid JSON response', () => {
      const response = '{"summaries": {"1": "summary A", "2": "summary B"}}';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(2);
      expect(results[0].onelineSummary).toBe('summary A');
      expect(results[1].onelineSummary).toBe('summary B');
    });

    it('returns empty array on null input', () => {
      expect(SummaryIndexService.parseBatchSummaryResponse(null, items).length).toBe(0);
    });

    it('returns empty array on invalid JSON', () => {
      expect(SummaryIndexService.parseBatchSummaryResponse('bad', items).length).toBe(0);
    });

    it('handles code-block wrapping', () => {
      const response = '```json\n{"summaries": {"1": "wrapped"}}\n```';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(1);
      expect(results[0].onelineSummary).toBe('wrapped');
    });

    it('uses title as fallback for empty summary', () => {
      const response = '{"summaries": {"1": ""}}';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(1);
      expect(results[0].onelineSummary).toBe('A');
    });

    it('skips indices not in batch items', () => {
      const response = '{"summaries": {"1": "valid", "99": "orphan"}}';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(1);
    });

    it('ignores non-numeric keys', () => {
      const response = '{"summaries": {"abc": "ignored", "1": "valid"}}';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(1);
    });

    it('returns empty array when summaries key is missing', () => {
      const response = '{"other": {}}';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(0);
    });

    it('handles partial responses (not all items)', () => {
      const response = '{"summaries": {"2": "only B"}}';
      const results = SummaryIndexService.parseBatchSummaryResponse(response, items);

      expect(results.length).toBe(1);
      expect(results[0].notePath).toBe(createNotePath('notes/b.md'));
    });
  });
});
