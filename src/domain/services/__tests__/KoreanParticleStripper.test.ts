import { describe, it, expect } from 'vitest';
import { stripKoreanParticles, preprocessQueryTokens } from '../KoreanParticleStripper';

describe('stripKoreanParticles', () => {
  it('strips common particles from Korean nouns', () => {
    expect(stripKoreanParticles('윤기범에')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범은')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범의')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범을')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범이')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범도')).toBe('윤기범');
  });

  it('strips multi-character particles', () => {
    expect(stripKoreanParticles('윤기범에게')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범에서')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범으로')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범부터')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범까지')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범처럼')).toBe('윤기범');
  });

  it('strips long particles', () => {
    expect(stripKoreanParticles('윤기범에서부터')).toBe('윤기범');
    expect(stripKoreanParticles('윤기범으로부터')).toBe('윤기범');
  });

  it('returns unchanged if no particle found', () => {
    expect(stripKoreanParticles('윤기범')).toBe('윤기범');
    expect(stripKoreanParticles('vault')).toBe('vault');
  });

  it('does not strip if stem would be too short', () => {
    expect(stripKoreanParticles('나는')).toBe('나는');
    expect(stripKoreanParticles('게의')).toBe('게의');
  });
});

describe('preprocessQueryTokens', () => {
  it('expands Korean tokens with both original and stripped forms', () => {
    const tokens = preprocessQueryTokens('윤기범에 대해서 알려줘');
    expect(tokens).toContain('윤기범에');
    expect(tokens).toContain('윤기범');
    expect(tokens).toContain('대해서');
    expect(tokens).toContain('알려줘');
  });

  it('handles English tokens unchanged', () => {
    const tokens = preprocessQueryTokens('vault에서 kally 찾아줘');
    expect(tokens).toContain('vault에서');
    expect(tokens).toContain('vault');
    expect(tokens).toContain('kally');
    expect(tokens).toContain('찾아줘');
  });

  it('deduplicates tokens', () => {
    const tokens = preprocessQueryTokens('윤기범 윤기범에');
    const count = tokens.filter(t => t === '윤기범').length;
    expect(count).toBe(1);
  });

  it('filters out single-character tokens', () => {
    const tokens = preprocessQueryTokens('나 는 것');
    expect(tokens).not.toContain('나');
  });
});
