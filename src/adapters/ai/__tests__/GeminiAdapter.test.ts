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

  describe('callClassification', () => {
    it('JSON 응답을 ClassificationResponse로 파싱한다', async () => {
      const aiJson = {
        category: 'science',
        tags: ['#physics'],
        folder: 'Science',
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
      expect(result.suggestedFolder).toBe('Science');
    });
  });
});
