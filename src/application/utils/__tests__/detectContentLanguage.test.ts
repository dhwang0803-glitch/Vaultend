import { describe, it, expect } from 'vitest';
import { detectContentLanguage } from '../detectContentLanguage';

describe('detectContentLanguage', () => {
  it('returns en for English text', () => {
    expect(detectContentLanguage('This is a note about React hooks')).toBe('en');
  });

  it('returns ko for Korean text', () => {
    expect(detectContentLanguage('이것은 리액트 훅에 대한 노트입니다')).toBe('ko');
  });

  it('returns en for empty string', () => {
    expect(detectContentLanguage('')).toBe('en');
  });

  it('returns en for text with >50% ASCII', () => {
    expect(detectContentLanguage('React hooks 사용법')).toBe('en');
  });

  it('returns ko for text with <=50% ASCII', () => {
    expect(detectContentLanguage('리액트 hooks 사용법과 패턴 정리')).toBe('ko');
  });

  it('returns en for code-heavy content', () => {
    const code = 'function hello() { return "world"; }';
    expect(detectContentLanguage(code)).toBe('en');
  });

  it('returns en for whitespace-only text', () => {
    expect(detectContentLanguage('   \n\t  ')).toBe('en');
  });
});
