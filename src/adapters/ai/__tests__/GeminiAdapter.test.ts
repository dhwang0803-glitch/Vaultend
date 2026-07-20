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
