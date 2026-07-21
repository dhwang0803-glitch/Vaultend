import { describe, it, expect } from 'vitest';
import { stripRelatedNotesSection, replaceRelatedNotesSection } from '../relatedNotesSection';

describe('stripRelatedNotesSection', () => {
  it('returns content unchanged when no Related Notes section exists', () => {
    const content = '# Title\n\nSome content.';
    expect(stripRelatedNotesSection(content)).toBe('# Title\n\nSome content.');
  });

  it('strips a single Related Notes section at end', () => {
    const content = '# Title\n\nSome content.\n\n## Related Notes\n\n- [[Note A]]\n- [[Note B]]';
    expect(stripRelatedNotesSection(content)).toBe('# Title\n\nSome content.');
  });

  it('strips multiple duplicate Related Notes sections', () => {
    const content = [
      '# Title',
      '',
      'Content.',
      '',
      '## Related Notes',
      '',
      '- [[Note A]]',
      '',
      '## Related Notes',
      '',
      '- [[Note B]]',
      '- [[Note C]]',
      '',
      '## Related Notes',
      '',
      '- [[Note D]]',
    ].join('\n');
    expect(stripRelatedNotesSection(content)).toBe('# Title\n\nContent.');
  });

  it('preserves other headings after Related Notes', () => {
    const content = '# Title\n\nContent.\n\n## Related Notes\n\n- [[A]]\n\n## Other Section\n\nMore text.';
    const result = stripRelatedNotesSection(content);
    expect(result).toContain('## Other Section');
    expect(result).toContain('More text.');
    expect(result).not.toContain('Related Notes');
  });

  it('handles content with no trailing newline', () => {
    const content = 'No heading\n\n## Related Notes\n\n- [[A]]';
    expect(stripRelatedNotesSection(content)).toBe('No heading');
  });
});

describe('replaceRelatedNotesSection', () => {
  it('appends Related Notes when none exists', () => {
    const content = '# Title\n\nContent.';
    const result = replaceRelatedNotesSection(content, ['Note A', 'Note B.md']);
    expect(result).toBe('# Title\n\nContent.\n\n## Related Notes\n\n- [[Note A]]\n- [[Note B]]');
  });

  it('replaces existing Related Notes section', () => {
    const content = '# Title\n\nContent.\n\n## Related Notes\n\n- [[Old Note]]';
    const result = replaceRelatedNotesSection(content, ['New Note']);
    expect(result).toBe('# Title\n\nContent.\n\n## Related Notes\n\n- [[New Note]]');
    expect(result).not.toContain('Old Note');
  });

  it('replaces multiple duplicate sections with a single one', () => {
    const content = 'Content\n\n## Related Notes\n\n- [[A]]\n\n## Related Notes\n\n- [[B]]';
    const result = replaceRelatedNotesSection(content, ['C']);
    expect(result).toBe('Content\n\n## Related Notes\n\n- [[C]]');
    const matches = result.match(/## Related Notes/g);
    expect(matches).toHaveLength(1);
  });

  it('returns stripped content when links array is empty', () => {
    const content = '# Title\n\nContent.\n\n## Related Notes\n\n- [[Old]]';
    const result = replaceRelatedNotesSection(content, []);
    expect(result).toBe('# Title\n\nContent.');
  });

  it('strips .md extension from link paths', () => {
    const result = replaceRelatedNotesSection('Content', ['Folder/Note.md']);
    expect(result).toContain('- [[Folder/Note]]');
    expect(result).not.toContain('.md');
  });
});
