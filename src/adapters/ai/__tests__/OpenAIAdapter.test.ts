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

    it('429 응답 시 재시도 후 RateLimitError를 던진다', async () => {
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
      expect(mockRequestUrl).toHaveBeenCalledTimes(4);
    }, 30_000);

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
        folder: 'Tech',
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
      expect(result.suggestedFolder).toBe('Tech');
      expect(result.summary).toBe('About TS');
      expect(result.confidence).toBe(0.95);
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

      expect(result.category).toBe('미분류');
      expect(result.suggestedTags).toEqual([]);
      expect(result.summary).toBe('');
    });
  });
});
