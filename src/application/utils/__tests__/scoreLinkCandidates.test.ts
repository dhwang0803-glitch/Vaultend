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

  it('uses content keywords to match candidates with different titles', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `Unrelated ${i}`);
    candidates[10] = '임베딩 모델 비교';
    candidates[20] = '시맨틱 검색 기법';
    candidates[30] = 'RAG 파이프라인';

    const content = `이 노트는 벡터 임베딩을 활용한 시맨틱 검색에 대해 설명합니다.
임베딩 모델은 텍스트를 벡터로 변환합니다. 시맨틱 검색은 의미 기반 검색입니다.
RAG 파이프라인은 임베딩과 검색을 결합합니다.`;

    const result = scoreLinkCandidates('프롬프트 엔지니어링', [], candidates, 5, content);

    expect(result).toContain('임베딩 모델 비교');
    expect(result).toContain('시맨틱 검색 기법');
    expect(result).toContain('RAG 파이프라인');
  });

  it('uses existing tags to boost matching candidates', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `Note ${i}`);
    candidates[5] = 'JavaScript Async Patterns';
    candidates[15] = 'Event Loop Deep Dive';

    const result = scoreLinkCandidates(
      'Node.js 이벤트 루프 이해하기',
      [],
      candidates,
      5,
      undefined,
      ['#javascript', '#async', '#event-loop'],
    );

    expect(result).toContain('JavaScript Async Patterns');
    expect(result).toContain('Event Loop Deep Dive');
  });

  it('strips Korean particles when extracting content keywords', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `Item ${i}`);
    candidates[7] = '검색 엔진 구현';

    const content = '검색은 중요한 기능입니다. 검색을 위해 인덱스를 만들어야 합니다. 검색이 빨라야 합니다.';

    const result = scoreLinkCandidates('데이터베이스', [], candidates, 5, content);

    expect(result).toContain('검색 엔진 구현');
  });
});
