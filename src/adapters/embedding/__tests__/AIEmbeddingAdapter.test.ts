import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIEmbeddingAdapter } from '../AIEmbeddingAdapter';
import { AIProviderPort } from '../../../application/ports/AIProviderPort';

describe('AIEmbeddingAdapter', () => {
  let adapter: AIEmbeddingAdapter;
  let mockAI: { callEmbedding: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockAI = {
      callEmbedding: vi.fn().mockResolvedValue({
        embeddings: [new Float32Array([0.1, 0.2, 0.3])],
        dimension: 3,
        tokenUsage: { promptTokens: 5, completionTokens: 0, totalTokens: 5, estimatedCostUsd: 0 },
      }),
    };
    adapter = new AIEmbeddingAdapter(mockAI as unknown as AIProviderPort);
  });

  it('initializes by calling embedding API with test text', async () => {
    const result = await adapter.initialize();
    expect(result).toBe(true);
    expect(adapter.isReady()).toBe(true);
    expect(adapter.getDimension()).toBe(3);
    expect(mockAI.callEmbedding).toHaveBeenCalledWith({
      texts: ['test'],
      model: undefined,
    });
  });

  it('returns false when provider returns empty embeddings', async () => {
    mockAI.callEmbedding.mockResolvedValue({
      embeddings: [],
      dimension: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    });
    const result = await adapter.initialize();
    expect(result).toBe(false);
    expect(adapter.isReady()).toBe(false);
    expect(adapter.getDimension()).toBe(0);
  });

  it('throws when API call fails', async () => {
    mockAI.callEmbedding.mockRejectedValue(new Error('network error'));
    await expect(adapter.initialize()).rejects.toThrow('network error');
    expect(adapter.isReady()).toBe(false);
  });

  it('embeds single text', async () => {
    await adapter.initialize();
    const result = await adapter.embed('hello world');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
  });

  it('embeds batch of texts', async () => {
    mockAI.callEmbedding.mockResolvedValue({
      embeddings: [
        new Float32Array([0.1, 0.2, 0.3]),
        new Float32Array([0.4, 0.5, 0.6]),
      ],
      dimension: 3,
      tokenUsage: { promptTokens: 10, completionTokens: 0, totalTokens: 10, estimatedCostUsd: 0 },
    });
    await adapter.initialize();
    const results = await adapter.embedBatch(['hello', 'world']);
    expect(results.length).toBe(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
  });

  it('throws if embed called before initialization', async () => {
    await expect(adapter.embed('test')).rejects.toThrow('Embedding not initialized');
  });
});
