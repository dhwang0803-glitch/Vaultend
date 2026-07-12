import { describe, it, expect } from 'vitest';
import { tokenizeForTfIdf } from '../tokenize';

describe('tokenizeForTfIdf', () => {
  it('strips frontmatter before tokenizing', () => {
    const text = '---\ntitle: Test\ntags: [a, b]\n---\nHello world content';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).not.toContain('title');
    expect(tokens).not.toContain('test');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('content');
  });

  it('removes markdown heading syntax', () => {
    const text = '## Architecture\nThis is about architecture.';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).toContain('architecture');
  });

  it('removes code blocks', () => {
    const text = 'Important text\n```typescript\nconst x = 1;\n```\nAnother text';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).not.toContain('const');
    expect(tokens).toContain('important');
    expect(tokens).toContain('text');
    expect(tokens).toContain('another');
  });

  it('extracts text from wiki links', () => {
    const text = 'See [[React Hooks]] for details about [[State Management|managing state]].';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).toContain('react');
    expect(tokens).toContain('hooks');
    expect(tokens).toContain('managing');
    expect(tokens).toContain('state');
  });

  it('filters stopwords', () => {
    const text = 'This is a test of the system and it should work.';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).not.toContain('this');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('and');
    expect(tokens).toContain('test');
    expect(tokens).toContain('system');
    expect(tokens).toContain('work');
  });

  it('filters tokens shorter than 2 characters', () => {
    const text = 'I am a cat in a hat.';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).not.toContain('i');
    expect(tokens).not.toContain('a');
    expect(tokens).toContain('cat');
    expect(tokens).toContain('hat');
  });

  it('handles Korean text correctly', () => {
    const text = '타입스크립트 프로그래밍 관련 정리 노트입니다.';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).toContain('타입스크립트');
    expect(tokens).toContain('프로그래밍');
    expect(tokens).toContain('노트입니다');
    // Korean stopwords filtered
    expect(tokens).not.toContain('관련');
  });

  it('handles empty text', () => {
    expect(tokenizeForTfIdf('')).toEqual([]);
  });

  it('handles text with only frontmatter', () => {
    const text = '---\ntitle: Empty\n---\n';
    const tokens = tokenizeForTfIdf(text);
    expect(tokens).toEqual([]);
  });
});
