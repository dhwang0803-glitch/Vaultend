import { describe, it, expect, vi } from 'vitest';
import { MaxResponseTokensAIAdapter } from '../MaxResponseTokensAIAdapter';
import { createMockAI, createMockConfig } from '../../../test-utils/mock-ports';
import type { AIProviderPort, CompletionRequest, CompletionResponse } from '../../../application/ports/AIProviderPort';

const req = (maxTokens: number): CompletionRequest => ({ prompt: 'p', systemPrompt: 's', maxTokens, temperature: 0.1, jsonMode: true });

const RESPONSE: CompletionResponse = {
  content: 'ok',
  tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCostUsd: 0 },
  finishReason: 'stop',
};

/** 스파이를 독립 변수로 만들어 주입 — 메서드 참조 분리(unbound-method) 없이 호출 인자를 검증 */
function spiedInner() {
  const callCompletion = vi.fn<AIProviderPort['callCompletion']>().mockResolvedValue(RESPONSE);
  const callClassification = vi.fn<AIProviderPort['callClassification']>();
  const callEmbedding = vi.fn<AIProviderPort['callEmbedding']>();
  const inner = createMockAI({ callCompletion, callClassification, callEmbedding });
  return { inner, callCompletion, callClassification, callEmbedding };
}

describe('MaxResponseTokensAIAdapter.effectiveMaxTokens', () => {
  it.each([
    // [호출 한도, 설정값, 기대]
    [200, 8192, 200],
    [300, 8192, 300],
    [4000, 8192, 4000],
    [4000, 16384, 4000],
    [4000, 2048, 2048],
    [4000, 1024, 1024],
    [800, 1024, 800],
  ])('호출 %i / 설정 %i → %i', (requested, configured, expected) => {
    expect(MaxResponseTokensAIAdapter.effectiveMaxTokens(requested, configured)).toBe(expected);
  });

  it('기본값(8192)에서는 현재 모든 호출 지점의 최대 한도(4000)를 바꾸지 않는다', () => {
    for (const requested of [200, 300, 400, 500, 800, 2000, 4000]) {
      expect(MaxResponseTokensAIAdapter.effectiveMaxTokens(requested, 8192)).toBe(requested);
    }
  });

  it.each([undefined, null, 'abc', Number.NaN, Number.POSITIVE_INFINITY])('설정값이 비정상(%s)이면 상한을 적용하지 않는다', (bad) => {
    expect(MaxResponseTokensAIAdapter.effectiveMaxTokens(4000, bad)).toBe(4000);
  });

  it('슬라이더 범위 밖 값은 범위로 보정한다 (data.json 수동 편집 방어)', () => {
    expect(MaxResponseTokensAIAdapter.effectiveMaxTokens(4000, 10)).toBe(1024);
    expect(MaxResponseTokensAIAdapter.effectiveMaxTokens(400, 0)).toBe(400);
    expect(MaxResponseTokensAIAdapter.effectiveMaxTokens(20000, 99999)).toBe(16384);
  });
});

describe('MaxResponseTokensAIAdapter 위임', () => {
  it('상한이 걸리지 않으면 요청 객체를 그대로(동일 참조) 전달한다', async () => {
    const { inner, callCompletion } = spiedInner();
    const a = new MaxResponseTokensAIAdapter(inner, createMockConfig({ aiMaxTokens: 8192 }));
    const r = req(300);

    await a.callCompletion(r);

    expect(callCompletion).toHaveBeenCalledWith(r);
    expect(callCompletion.mock.calls[0][0]).toBe(r);
  });

  it('상한이 걸리면 maxTokens만 바꾸고 나머지 필드는 보존한다', async () => {
    const { inner, callCompletion } = spiedInner();
    const a = new MaxResponseTokensAIAdapter(inner, createMockConfig({ aiMaxTokens: 1024 }));

    await a.callCompletion(req(4000));

    expect(callCompletion).toHaveBeenCalledWith({ ...req(4000), maxTokens: 1024 });
  });

  it('응답은 내부 어댑터 결과를 그대로 반환한다', async () => {
    const { inner } = spiedInner();
    const a = new MaxResponseTokensAIAdapter(inner, createMockConfig({ aiMaxTokens: 8192 }));

    await expect(a.callCompletion(req(300))).resolves.toBe(RESPONSE);
  });

  it('분류·임베딩은 변경 없이 위임한다', async () => {
    const { inner, callClassification, callEmbedding } = spiedInner();
    const a = new MaxResponseTokensAIAdapter(inner, createMockConfig({ aiMaxTokens: 1024 }));
    const cls = { text: 't', existingTags: ['a'] };
    const emb = { texts: ['x'], model: 'm' };

    await a.callClassification(cls);
    await a.callEmbedding(emb);

    expect(callClassification.mock.calls[0][0]).toBe(cls);
    expect(callEmbedding.mock.calls[0][0]).toBe(emb);
  });

  it('내부 어댑터 오류를 그대로 전파한다', async () => {
    const err = new Error('boom');
    const inner = createMockAI({ callCompletion: vi.fn().mockRejectedValue(err) });
    const a = new MaxResponseTokensAIAdapter(inner, createMockConfig({ aiMaxTokens: 8192 }));

    await expect(a.callCompletion(req(300))).rejects.toBe(err);
  });
});
