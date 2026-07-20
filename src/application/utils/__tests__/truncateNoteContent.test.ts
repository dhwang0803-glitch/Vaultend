import { describe, it, expect } from 'vitest';
import { truncateNoteContent, extractHeadings, CONTENT_HARD_CAP } from '../truncateNoteContent';

describe('truncateNoteContent', () => {
  describe('short content (under cap)', () => {
    it('returns content unchanged', () => {
      const content = 'Short note content.';
      const result = truncateNoteContent(content);

      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(content);
      expect(result.originalLength).toBe(content.length);
      expect(result.truncatedLength).toBe(content.length);
    });

    it('returns unchanged at exact cap boundary', () => {
      const content = 'x'.repeat(CONTENT_HARD_CAP);
      const result = truncateNoteContent(content);

      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(content);
    });
  });

  describe('headless notes (no headings)', () => {
    it('preserves front 75% and truncates rest', () => {
      const content = 'a'.repeat(20_000);
      const result = truncateNoteContent(content, 10_000);

      expect(result.wasTruncated).toBe(true);
      expect(result.truncatedLength).toBeLessThanOrEqual(10_000);
      expect(result.originalLength).toBe(20_000);
      expect(result.content).toContain('[...');
      expect(result.content).toContain('chars omitted');
      expect(result.content.startsWith('a'.repeat(100))).toBe(true);
    });

    it('inserts omission marker with correct char count', () => {
      const content = 'b'.repeat(2000);
      const result = truncateNoteContent(content, 1000);

      const markerMatch = result.content.match(/\[... (\d+) chars omitted .../);
      expect(markerMatch).not.toBeNull();
      const omitted = parseInt(markerMatch[1], 10);
      expect(omitted).toBe(2000 - Math.floor(1000 * 0.75));
    });
  });

  describe('headed notes (with headings)', () => {
    it('preserves first and last sections fully, truncates middle', () => {
      const first = '# Title\n\nIntroduction paragraph here.\n\n';
      const middle = '## Section A\n\n' + 'middle content '.repeat(200) + '\n\n';
      const last = '## References\n\nSome links here.\n';
      const content = first + middle + last;

      const result = truncateNoteContent(content, 500);

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('# Title');
      expect(result.content).toContain('## Section A');
      expect(result.content).toContain('## References');
      expect(result.content).toContain('chars omitted');
    });

    it('handles two sections (no middle to truncate)', () => {
      const content = '# Title\n\n' + 'a'.repeat(5000) + '\n\n## End\n\n' + 'b'.repeat(5000);

      const result = truncateNoteContent(content, 5000);

      expect(result.wasTruncated).toBe(true);
      expect(result.truncatedLength).toBeLessThanOrEqual(5000);
    });

    it('truncates multiple middle sections independently', () => {
      const first = '# Title\n\nIntro.\n\n';
      const midA = '## Section A\n\n' + 'a'.repeat(3000) + '\n\n';
      const midB = '## Section B\n\n' + 'b'.repeat(3000) + '\n\n';
      const last = '## Conclusion\n\nEnd.\n';
      const content = first + midA + midB + last;

      const result = truncateNoteContent(content, 3000);

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('## Section A');
      expect(result.content).toContain('## Section B');
      expect(result.content).toContain('## Conclusion');
    });

    it('applies proportional reduction when sectional truncation is not enough', () => {
      const sections = Array.from({ length: 5 }, (_, i) =>
        `## Section ${i}\n\n${'x'.repeat(10_000)}\n\n`,
      );
      const content = sections.join('');

      const result = truncateNoteContent(content, 5000);

      expect(result.wasTruncated).toBe(true);
      expect(result.truncatedLength).toBeLessThanOrEqual(5000);
    });
  });

  describe('custom hardCap', () => {
    it('respects custom cap value', () => {
      const content = 'z'.repeat(5000);
      const result = truncateNoteContent(content, 2000);

      expect(result.wasTruncated).toBe(true);
      expect(result.truncatedLength).toBeLessThanOrEqual(2000);
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const result = truncateNoteContent('');
      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe('');
    });

    it('handles content with only headings', () => {
      const content = '# Title\n\n## Section\n\n## Another\n';
      const result = truncateNoteContent(content);

      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(content);
    });

    it('handles content starting with text before first heading', () => {
      const preamble = 'Some frontmatter text.\n\n';
      const heading = '## Main\n\n' + 'x'.repeat(20_000);
      const content = preamble + heading;

      const result = truncateNoteContent(content, 5000);

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('Some frontmatter text.');
      expect(result.content).toContain('## Main');
    });

    it('preserves Korean content correctly', () => {
      const content = '# 제목\n\n소개 문단입니다.\n\n## 본문\n\n' +
        '한글 내용 '.repeat(2000) + '\n\n## 결론\n\n마무리입니다.';

      const result = truncateNoteContent(content, 5000);

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toContain('# 제목');
      expect(result.content).toContain('## 결론');
    });
  });
});

describe('extractHeadings', () => {
  it('extracts headings from content', () => {
    const content = '# Title\n\nSome text.\n\n## Section A\n\nMore text.\n\n### Sub B\n';
    const headings = extractHeadings(content);

    expect(headings).toEqual(['Title', 'Section A', 'Sub B']);
  });

  it('returns empty array for content without headings', () => {
    expect(extractHeadings('Just plain text.')).toEqual([]);
  });

  it('handles Korean headings', () => {
    const content = '# 제목\n\n## 섹션 A\n';
    expect(extractHeadings(content)).toEqual(['제목', '섹션 A']);
  });
});
