import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAdapter } from '../GeminiAdapter';
import { AIProviderError, RateLimitError } from '../../../domain/errors/DomainErrors';
import { requestUrl } from 'obsidian';

const mockRequestUrl = vi.mocked(requestUrl);

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter('test-gemini-key', 'gemini-1.5-flash');
  });

  describe('callCompletion', () => {
    it('정상 응답을 CompletionResponse로 매핑한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: 'Gemini says hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callCompletion({
        prompt: 'Hello',
        maxTokens: 100,
        temperature: 0.5,
      });

      expect(result.content).toBe('Gemini says hi');
      expect(result.tokenUsage.promptTokens).toBe(8);
      expect(result.tokenUsage.completionTokens).toBe(4);
      expect(result.finishReason).toBe('stop');
    });

    it('URL에 API 키를 쿼리 파라미터로 포함한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }],
          usageMetadata: {},
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await adapter.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 });

      const url = mockRequestUrl.mock.calls[0][0].url;
      expect(url).toContain('key=test-gemini-key');
      expect(url).toContain('gemini-1.5-flash');
    });

    it('systemPrompt가 있으면 systemInstruction을 포함한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }],
          usageMetadata: {},
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await adapter.callCompletion({
        prompt: 'q', systemPrompt: 'Be helpful.', maxTokens: 10, temperature: 0,
      });

      const body = JSON.parse(mockRequestUrl.mock.calls[0][0].body as string);
      expect(body.systemInstruction.parts[0].text).toBe('Be helpful.');
    });

    it('finishReason을 올바르게 매핑한다', async () => {
      const cases: Array<[string, string]> = [
        ['STOP', 'stop'],
        ['MAX_TOKENS', 'length'],
        ['SAFETY', 'content_filter'],
        ['OTHER', 'stop'],
      ];

      for (const [geminiReason, expected] of cases) {
        mockRequestUrl.mockResolvedValue({
          status: 200,
          json: {
            candidates: [{ content: { parts: [{ text: '' }] }, finishReason: geminiReason }],
            usageMetadata: {},
          },
          headers: {},
          text: '',
          arrayBuffer: new ArrayBuffer(0),
        });

        const result = await adapter.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 });
        expect(result.finishReason).toBe(expected);
      }
    });

    it('429 응답 시 즉시 RateLimitError를 던진다 (circuit breaker)', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 429,
        json: {},
        headers: { 'retry-after': '1' },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await expect(adapter.callCompletion({
        prompt: 'x', maxTokens: 10, temperature: 0,
      })).rejects.toThrow(RateLimitError);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('에러 응답 시 AIProviderError를 던진다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 400,
        json: { error: { message: 'Bad request' } },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await expect(adapter.callCompletion({
        prompt: 'x', maxTokens: 10, temperature: 0,
      })).rejects.toThrow(AIProviderError);
    });

    it('네트워크 에러 시 AIProviderError를 던진다', async () => {
      mockRequestUrl.mockRejectedValue(new Error('Timeout'));

      await expect(adapter.callCompletion({
        prompt: 'x', maxTokens: 10, temperature: 0,
      })).rejects.toThrow(AIProviderError);
    });

    it('usageMetadata 없이도 정상 처리된다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 });
      expect(result.content).toBe('ok');
      expect(result.tokenUsage.promptTokens).toBe(0);
    });
  });

  describe('callCompletion — thinking 모델 대응', () => {
    const ok = (parts: Array<{ text?: string; thought?: boolean }>, usage: Record<string, number> = {}) => ({
      status: 200,
      json: { candidates: [{ content: { parts }, finishReason: 'STOP' }], usageMetadata: usage },
      headers: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    });
    const bodyOf = (call: number) =>
      JSON.parse(mockRequestUrl.mock.calls[call][0].body as string) as { generationConfig: Record<string, unknown> };

    it('Gemini 3.x Flash: thinkingLevel low + 호출자 temperature 유지 + 출력 예산 확보', async () => {
      const a = new GeminiAdapter('k', 'gemini-3.5-flash');
      mockRequestUrl.mockResolvedValue(ok([{ text: '{}' }]));

      await a.callCompletion({ prompt: 'x', maxTokens: 400, temperature: 0.1, jsonMode: true });

      const gc = bodyOf(0).generationConfig;
      expect(gc.thinkingConfig).toEqual({ thinkingLevel: 'low' });
      expect(gc.temperature).toBe(0.1);
      expect(gc.maxOutputTokens).toBe(400 + 2048);
      expect(gc.responseMimeType).toBe('application/json');
    });

    it('Gemini 2.5 Flash: thinkingBudget 0 + temperature 유지', async () => {
      const a = new GeminiAdapter('k', 'gemini-2.5-flash');
      mockRequestUrl.mockResolvedValue(ok([{ text: '{}' }]));

      await a.callCompletion({ prompt: 'x', maxTokens: 200, temperature: 0.1 });

      const gc = bodyOf(0).generationConfig;
      expect(gc.thinkingConfig).toEqual({ thinkingBudget: 0 });
      expect(gc.temperature).toBe(0.1);
      expect(gc.maxOutputTokens).toBe(200 + 2048);
    });

    it('레거시 모델은 요청 본문이 이전과 동일하다', async () => {
      mockRequestUrl.mockResolvedValue(ok([{ text: '{}' }]));

      await adapter.callCompletion({ prompt: 'x', maxTokens: 400, temperature: 0.1, jsonMode: true });

      expect(bodyOf(0).generationConfig).toEqual({
        maxOutputTokens: 400, temperature: 0.1, responseMimeType: 'application/json',
      });
    });

    it('여러 텍스트 파트를 이어 붙이고 thought 파트는 제외한다', async () => {
      mockRequestUrl.mockResolvedValue(ok([
        { text: 'internal reasoning', thought: true },
        { text: '{"category":' },
        { text: '"x"}' },
      ]));

      const r = await adapter.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 });
      expect(r.content).toBe('{"category":"x"}');
    });

    it('thoughtsTokenCount를 completionTokens에 합산한다 (출력 요금으로 과금)', async () => {
      const a = new GeminiAdapter('k', 'gemini-3.1-flash-lite');
      mockRequestUrl.mockResolvedValue(ok([{ text: '{}' }], {
        promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 150, totalTokenCount: 300,
      }));

      const r = await a.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 });
      expect(r.tokenUsage.completionTokens).toBe(200);
      expect(r.tokenUsage.totalTokens).toBe(300);
      // gemini-3.1-flash-lite: $0.25 in / $1.50 out per 1M
      expect(r.tokenUsage.estimatedCostUsd).toBeCloseTo((100 * 0.25 + 200 * 1.5) / 1_000_000, 12);
    });

    it('thinkingConfig가 400으로 거부되면 제외하고 1회 재시도하며, 이후 호출에서도 보내지 않는다', async () => {
      const a = new GeminiAdapter('k', 'gemini-4-flash');
      mockRequestUrl
        .mockRejectedValueOnce(new Error('Request failed, status 400'))
        .mockResolvedValue(ok([{ text: 'ok' }]));

      const r = await a.callCompletion({ prompt: 'x', maxTokens: 100, temperature: 0 });
      expect(r.content).toBe('ok');
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);
      expect(bodyOf(0).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
      expect(bodyOf(1).generationConfig).not.toHaveProperty('thinkingConfig');
      expect(bodyOf(1).generationConfig.maxOutputTokens).toBe(100 + 2048);

      await a.callCompletion({ prompt: 'y', maxTokens: 100, temperature: 0 });
      expect(mockRequestUrl).toHaveBeenCalledTimes(3);
      expect(bodyOf(2).generationConfig).not.toHaveProperty('thinkingConfig');
    });

    it('thinkingConfig를 보내지 않은 모델의 400은 재시도 없이 그대로 던진다', async () => {
      mockRequestUrl.mockRejectedValue(new Error('Request failed, status 400'));

      await expect(adapter.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 }))
        .rejects.toThrow(AIProviderError);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('400이 아닌 오류(401)는 폴백하지 않는다', async () => {
      const a = new GeminiAdapter('k', 'gemini-3.5-flash');
      mockRequestUrl.mockRejectedValue(new Error('Request failed, status 401'));

      await expect(a.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 }))
        .rejects.toThrow(AIProviderError);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('폴백 재시도도 실패하면 그 오류를 던진다', async () => {
      const a = new GeminiAdapter('k', 'gemini-3.5-flash');
      mockRequestUrl.mockRejectedValue(new Error('Request failed, status 400'));

      await expect(a.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 }))
        .rejects.toThrow(AIProviderError);
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('callClassification', () => {
    it('JSON 응답을 ClassificationResponse로 파싱한다', async () => {
      const aiJson = {
        category: 'science',
        tags: ['#physics'],
        summary: 'Physics note',
        confidence: 0.88,
      };
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: JSON.stringify(aiJson) }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15, totalTokenCount: 35 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callClassification({
        text: 'Quantum mechanics basics',
        task: 'classify-and-tag',
      });

      expect(result.category).toBe('science');
      expect(result.suggestedTags).toEqual(['#physics']);
    });

    it('per-tag score 형식을 파싱하고 70 미만을 필터링한다', async () => {
      const aiJson = {
        tags: [
          { tag: '#physics', score: 95, isNew: false, reason: 'core physics topic' },
          { tag: '#weak-match', score: 30, isNew: true, reason: 'loosely related' },
          { tag: '#quantum', score: 82, isNew: true, reason: 'quantum mechanics content' },
        ],
        summary: 'Quantum note',
        confidence: 0.88,
      };
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: JSON.stringify(aiJson) }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15, totalTokenCount: 35 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callClassification({
        text: 'Quantum mechanics basics',
        task: 'classify-and-tag',
      });

      expect(result.suggestedTags).toEqual(['#physics', '#quantum']);
      expect(result.suggestedTags).not.toContain('#weak-match');
      expect(result.tagDetails).toBeDefined();
      expect(result.tagDetails).toHaveLength(2);
      expect(result.tagDetails![1]).toEqual({
        tag: '#quantum', score: 82, isNew: true, reason: 'quantum mechanics content',
      });
    });
  });

  describe('callEmbedding', () => {
    it('returns Float32Array embeddings from Gemini batchEmbedContents', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          embeddings: [
            { values: [0.1, 0.2, 0.3, 0.4] },
            { values: [0.5, 0.6, 0.7, 0.8] },
          ],
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callEmbedding({ texts: ['hello', 'world'] });

      expect(result.embeddings.length).toBe(2);
      expect(result.embeddings[0]).toBeInstanceOf(Float32Array);
      expect(result.embeddings[0].length).toBe(4);
      expect(result.dimension).toBe(4);
    });

    it('uses gemini-embedding-001 as default model', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: { embeddings: [{ values: [0.1] }] },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await adapter.callEmbedding({ texts: ['test'] });

      const url = mockRequestUrl.mock.calls[0][0].url as string;
      expect(url).toContain('gemini-embedding-001');
    });
  });
});
