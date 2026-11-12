import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from '../OpenAIAdapter';
import { AIProviderError, RateLimitError } from '../../../domain/errors/DomainErrors';
import { requestUrl } from 'obsidian';

const mockRequestUrl = vi.mocked(requestUrl);

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter('test-api-key', 'gpt-4o');
  });

  describe('callCompletion — reasoning 모델 판별', () => {
    const okResponse = {
      status: 200,
      json: {
        choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      headers: {}, text: '', arrayBuffer: new ArrayBuffer(0),
    };
    const bodyOf = () => JSON.parse(mockRequestUrl.mock.calls[0][0].body as string) as Record<string, unknown>;

    it.each(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'])(
      '%s: max_completion_tokens + reasoning_effort low (max_tokens·temperature 미전송)', async (model) => {
        mockRequestUrl.mockResolvedValue(okResponse);
        await new OpenAIAdapter('k', model).callCompletion({ prompt: 'x', maxTokens: 300, temperature: 0.1, jsonMode: true });

        const body = bodyOf();
        expect(body.max_completion_tokens).toBe(1200);
        expect(body.reasoning_effort).toBe('low');
        expect(body).not.toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('temperature');
      });

    it.each(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'])(
      '%s: 기존 non-reasoning 요청 그대로 (회귀 방지)', async (model) => {
        mockRequestUrl.mockResolvedValue(okResponse);
        await new OpenAIAdapter('k', model).callCompletion({ prompt: 'x', maxTokens: 300, temperature: 0.1, jsonMode: true });

        const body = bodyOf();
        expect(body.max_tokens).toBe(300);
        expect(body.temperature).toBe(0.1);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body).not.toHaveProperty('max_completion_tokens');
        expect(body).not.toHaveProperty('reasoning_effort');
      });

    it.each([
      ['gpt-6-astra', 10.00, 50.00],
      ['gpt-6.1-sol', 2.00, 10.00],
      ['gpt-6.1-terra', 1.00, 5.00],
      ['gpt-6-luna', 0.10, 0.50],
    ])('%s: 가격표로 비용을 추정한다 (입력 $%s / 출력 $%s per 1M)', async (model, inPer1M, outPer1M) => {
      mockRequestUrl.mockResolvedValue({
        ...okResponse,
        json: { ...okResponse.json, usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } },
      });
      const r = await new OpenAIAdapter('k', model).callCompletion({ prompt: 'x', maxTokens: 300, temperature: 0.1 });

      expect(r.tokenUsage.estimatedCostUsd).toBeCloseTo((1000 * inPer1M + 500 * outPer1M) / 1_000_000, 12);
    });

    it.each(['gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini'])('%s: 기존 reasoning 요청 그대로 (회귀 방지)', async (model) => {
      mockRequestUrl.mockResolvedValue(okResponse);
      await new OpenAIAdapter('k', model).callCompletion({ prompt: 'x', maxTokens: 300, temperature: 0.1 });

      const body = bodyOf();
      expect(body.max_completion_tokens).toBe(1200);
      expect(body.reasoning_effort).toBe('low');
    });
  });

  describe('callCompletion', () => {
    it('정상 응답을 CompletionResponse로 매핑한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callCompletion({
        prompt: 'Say hello',
        maxTokens: 100,
        temperature: 0.7,
      });

      expect(result.content).toBe('Hello!');
      expect(result.tokenUsage.promptTokens).toBe(10);
      expect(result.tokenUsage.completionTokens).toBe(5);
      expect(result.tokenUsage.totalTokens).toBe(15);
      expect(result.finishReason).toBe('stop');
    });

    it('systemPrompt가 있으면 system 메시지를 포함한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: 'resp' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await adapter.callCompletion({
        prompt: 'query',
        systemPrompt: 'You are helpful.',
        maxTokens: 100,
        temperature: 0.7,
      });

      const body = JSON.parse(mockRequestUrl.mock.calls[0][0].body as string);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'query' });
    });

    it('Authorization 헤더에 API 키를 포함한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await adapter.callCompletion({ prompt: 'x', maxTokens: 10, temperature: 0 });

      const headers = mockRequestUrl.mock.calls[0][0].headers;
      expect(headers?.['Authorization']).toBe('Bearer test-api-key');
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

    it('5xx 응답 시 AIProviderError를 던진다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 500,
        json: { error: { message: 'Internal' } },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await expect(adapter.callCompletion({
        prompt: 'x', maxTokens: 10, temperature: 0,
      })).rejects.toThrow(AIProviderError);
    });

    it('네트워크 에러 시 AIProviderError를 던진다', async () => {
      mockRequestUrl.mockRejectedValue(new Error('Network failed'));

      await expect(adapter.callCompletion({
        prompt: 'x', maxTokens: 10, temperature: 0,
      })).rejects.toThrow(AIProviderError);
    });

    it('비용을 추정한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: 'r' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callCompletion({ prompt: 'x', maxTokens: 100, temperature: 0 });
      expect(result.tokenUsage.estimatedCostUsd).toBeGreaterThan(0);
    });
  });

  describe('callClassification', () => {
    it('AI 응답 JSON을 ClassificationResponse로 파싱한다', async () => {
      const aiJson = {
        category: 'technology',
        tags: ['#typescript', '#react'],
        summary: 'About TS',
        confidence: 0.95,
      };
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: JSON.stringify(aiJson) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callClassification({
        text: 'TypeScript and React',
        task: 'classify-and-tag',
      });

      expect(result.category).toBe('technology');
      expect(result.suggestedTags).toEqual(['#typescript', '#react']);
      expect(result.summary).toBe('About TS');
      expect(result.confidence).toBe(0.95);
    });

    it('per-tag score 형식을 파싱하고 70 미만을 필터링한다', async () => {
      const aiJson = {
        tags: [
          { tag: '#react', score: 92, isNew: false, reason: 'React framework discussion' },
          { tag: '#vague-topic', score: 45, isNew: true, reason: 'loosely related' },
          { tag: '#typescript', score: 78, isNew: false, reason: 'TypeScript code examples' },
        ],
        summary: 'About TS and React',
        confidence: 0.9,
      };
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: JSON.stringify(aiJson) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callClassification({
        text: 'React and TypeScript code',
        task: 'classify-and-tag',
      });

      expect(result.suggestedTags).toEqual(['#react', '#typescript']);
      expect(result.suggestedTags).not.toContain('#vague-topic');
      expect(result.tagDetails).toBeDefined();
      expect(result.tagDetails).toHaveLength(2);
      expect(result.tagDetails![0]).toEqual({
        tag: '#react', score: 92, isNew: false, reason: 'React framework discussion',
      });
    });

    it('기존 confidence 형식을 폴백으로 처리한다 (0.0-1.0 → 0-100 변환)', async () => {
      const aiJson = {
        tags: [
          { tag: '#react', confidence: 0.92 },
          { tag: '#weak', confidence: 0.45 },
        ],
        summary: 'About React',
        confidence: 0.9,
      };
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: JSON.stringify(aiJson) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callClassification({
        text: 'React code',
        task: 'classify-and-tag',
      });

      expect(result.suggestedTags).toEqual(['#react']);
      expect(result.tagDetails).toHaveLength(1);
      expect(result.tagDetails![0].score).toBe(92);
    });

    it('AI가 부분 JSON을 반환해도 기본값으로 처리한다', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callClassification({
        text: 'some text',
        task: 'classify-and-tag',
      });

      expect(result.category).toBe('');
      expect(result.suggestedTags).toEqual([]);
      expect(result.summary).toBe('');
    });
  });

  describe('callEmbedding', () => {
    it('returns Float32Array embeddings from OpenAI /embeddings endpoint', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.4, 0.5, 0.6] },
          ],
          usage: { prompt_tokens: 12, total_tokens: 12 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      const result = await adapter.callEmbedding({ texts: ['hello', 'world'] });

      expect(result.embeddings.length).toBe(2);
      expect(result.embeddings[0]).toBeInstanceOf(Float32Array);
      expect(result.dimension).toBe(3);
      expect(result.tokenUsage.promptTokens).toBe(12);
    });

    it('uses custom model when specified', async () => {
      mockRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        },
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      });

      await adapter.callEmbedding({ texts: ['test'], model: 'text-embedding-3-large' });

      const body = JSON.parse(mockRequestUrl.mock.calls[0][0].body as string);
      expect(body.model).toBe('text-embedding-3-large');
    });
  });
});
