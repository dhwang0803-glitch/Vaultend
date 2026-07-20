import { describe, it, expect } from 'vitest';
import { scoreLinkCandidates } from '../scoreLinkCandidates';

describe('scoreLinkCandidates', () => {
  it('returns all candidates when count is under max', () => {
    const candidates = ['Note A', 'Note B', 'Note C'];
    const result = scoreLinkCandidates('My Note', [], candidates, 50);
    expect(result).toEqual(candidates);
  });

  it('returns maxCandidates results when candidates exceed max', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `Note ${i}`);
    const result = scoreLinkCandidates('Title', [], candidates, 10);
    expect(result).toHaveLength(10);
  });

  it('prioritizes candidates with matching tokens from title', () => {
    const candidates = ['React Patterns', 'Cooking Tips', 'React Hooks Guide', 'Gardening'];
    const result = scoreLinkCandidates('React Components', [], candidates, 2);

    expect(result).toContain('React Patterns');
    expect(result).toContain('React Hooks Guide');
  });

  it('uses headings for matching as well', () => {
    const candidates = ['TypeScript Guide', 'Python Tips', 'Testing Patterns', 'Cooking'];
    const result = scoreLinkCandidates(
      'My Note',
      ['TypeScript Basics', 'Testing Strategy'],
      candidates,
      2,
    );

    expect(result).toContain('TypeScript Guide');
    expect(result).toContain('Testing Patterns');
  });

  it('fills remaining slots with unmatched candidates for diversity', () => {
    const candidates = ['React Guide', 'Unrelated A', 'Unrelated B', 'Unrelated C'];
    const result = scoreLinkCandidates('React', [], candidates, 3);

    expect(result[0]).toBe('React Guide');
    expect(result).toHaveLength(3);
  });

  it('handles empty title and headings gracefully', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `Note ${i}`);
    const result = scoreLinkCandidates('', [], candidates, 50);
    expect(result).toHaveLength(50);
  });

  it('handles Korean note names', () => {
    const candidates = ['리액트 패턴', '파이썬 가이드', '리액트 훅', '요리법'];
    const result = scoreLinkCandidates('리액트 컴포넌트', [], candidates, 2);

    expect(result).toContain('리액트 패턴');
    expect(result).toContain('리액트 훅');
  });

  it('is case-insensitive', () => {
    const candidates = ['REACT Guide', 'react patterns', 'Python Tips'];
    const result = scoreLinkCandidates('React', [], candidates, 2);

    expect(result).toContain('REACT Guide');
    expect(result).toContain('react patterns');
  });

  it('tokenizes on hyphens, underscores, and dots', () => {
    const candidates = ['react-patterns', 'react_hooks', 'cooking.recipes', 'react.guide'];
    const result = scoreLinkCandidates('React Guide', [], candidates, 3);

    expect(result).toContain('react.guide');
    expect(result).toContain('react-patterns');
    expect(result).toContain('react_hooks');
  });
});
