import { describe, it, expect } from 'vitest';
import { GeminiGenerationPolicy } from '../GeminiGenerationPolicy';

describe('GeminiGenerationPolicy.resolve', () => {
  it.each([
    'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash',
    'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
  ])('%s: thinkingLevel low + thinking 예산 확보', (model) => {
    const p = GeminiGenerationPolicy.resolve(model);
    expect(p.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(p.consumesThinkingTokens).toBe(true);
  });

  it.each(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite-preview'])(
    '%s: lite 계열은 thinkingConfig 미전송', (model) => {
      const p = GeminiGenerationPolicy.resolve(model);
      expect(p.thinkingConfig).toBeUndefined();
      expect(p.consumesThinkingTokens).toBe(true);
    });

  it('gemini-2.5-flash: thinkingBudget 0 (thinkingLevel은 2.5에서 400)', () => {
    const p = GeminiGenerationPolicy.resolve('gemini-2.5-flash');
    expect(p.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(p.consumesThinkingTokens).toBe(true);
  });

  it('gemini-2.5-flash-lite: 기존 동작 그대로 (thinking 기본 비활성)', () => {
    const p = GeminiGenerationPolicy.resolve('gemini-2.5-flash-lite');
    expect(p.thinkingConfig).toBeUndefined();
    expect(p.consumesThinkingTokens).toBe(false);
  });

  it('gemini-2.5-pro: thinking 비활성 불가 → thinkingConfig 없이 예산만 확보', () => {
    const p = GeminiGenerationPolicy.resolve('gemini-2.5-pro');
    expect(p.thinkingConfig).toBeUndefined();
    expect(p.consumesThinkingTokens).toBe(true);
  });

  it.each(['gemini-1.5-flash', 'gemini-2.0-flash', 'gemma-3-27b-it', 'my-custom-model', ''])(
    '%s: 규칙에 없는 모델은 기존(레거시) 동작 유지', (model) => {
      const p = GeminiGenerationPolicy.resolve(model);
      expect(p.thinkingConfig).toBeUndefined();
      expect(p.consumesThinkingTokens).toBe(false);
    });

  it('models/ 접두사·대문자·공백을 정규화한다', () => {
    expect(GeminiGenerationPolicy.resolve(' models/Gemini-3.5-Flash ').thinkingConfig)
      .toEqual({ thinkingLevel: 'low' });
  });

  it('미래 메이저 버전도 3.x 정책을 따른다 (거부 시 어댑터가 폴백)', () => {
    expect(GeminiGenerationPolicy.resolve('gemini-4-flash').thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(GeminiGenerationPolicy.resolve('gemini-4.1-flash-lite').thinkingConfig).toBeUndefined();
  });
});

describe('GeminiGenerationPolicy.maxOutputTokens', () => {
  it('thinking 모델은 요청 예산에 headroom을 더한다', () => {
    const p = GeminiGenerationPolicy.resolve('gemini-3.5-flash');
    expect(GeminiGenerationPolicy.maxOutputTokens(p, 400))
      .toBe(400 + GeminiGenerationPolicy.THINKING_HEADROOM_TOKENS);
  });

  it('레거시 모델은 요청 예산 그대로', () => {
    const p = GeminiGenerationPolicy.resolve('gemini-1.5-flash');
    expect(GeminiGenerationPolicy.maxOutputTokens(p, 400)).toBe(400);
  });

  it('최대 호출 예산(4000)에서도 Gemini 출력 한도(65,536) 이내', () => {
    const p = GeminiGenerationPolicy.resolve('gemini-3.5-flash');
    expect(GeminiGenerationPolicy.maxOutputTokens(p, 4000)).toBeLessThanOrEqual(65_536);
  });
});

describe('GeminiGenerationPolicy.isBadRequest', () => {
  it('직접 상태 코드 400', () => {
    expect(GeminiGenerationPolicy.isBadRequest(400, '{"error":{}}')).toBe(true);
  });
  it('Obsidian requestUrl 예외 메시지 형태 (statusCode 0)', () => {
    expect(GeminiGenerationPolicy.isBadRequest(0, 'Request failed, status 400')).toBe(true);
  });
  it.each([
    [404, 'not found'],
    [0, 'Request failed, status 404'],
    [0, 'Request failed, status 4000'],
    [500, 'status 400'],
    [0, 'net::ERR_CONNECTION_RESET'],
  ])('%s / %s → false', (code, detail) => {
    expect(GeminiGenerationPolicy.isBadRequest(code, detail)).toBe(false);
  });
});
