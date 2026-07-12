import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIEmbeddingAdapter } from '../AIEmbeddingAdapter';
import { AIProviderPort } from '../../../application/ports/AIProviderPort';
import { ConfigPort, PluginSettings } from '../../../application/ports/ConfigPort';

describe('AIEmbeddingAdapter', () => {
  let adapter: AIEmbeddingAdapter;
  let mockAI: { callEmbedding: ReturnType<typeof vi.fn> };
  let mockConfig: ConfigPort;

  const fakeSettings = {
    aiApiKey: 'test-key',
    embeddingsModel: 'text-embedding-3-small',
  } as PluginSettings;

  beforeEach(() => {
    mockAI = {
      callEmbedding: vi.fn().mockResolvedValue({
        embeddings: [new Float32Array([0.1, 0.2, 0.3])],
        dimension: 3,
        tokenUsage: { promptTokens: 5, completionTokens: 0, totalTokens: 5, estimatedCostUsd: 0 },
      }),
    };
    mockConfig = {
      getSettings: vi.fn().mockResolvedValue(fakeSettings),
      saveSettings: vi.fn(),
      updateSettings: vi.fn(),
    };
    adapter = new AIEmbeddingAdapter(mockAI as unknown as AIProviderPort, mockConfig);
  });

  it('initializes by calling embedding API with test text', async () => {
    const result = await adapter.initialize();
    expect(result).toBe(true);
    expect(adapter.isReady()).toBe(true);
    expect(adapter.getDimension()).toBe(3);
    expect(mockAI.callEmbedding).toHaveBeenCalledWith({
      texts: ['test'],
      model: 'text-embedding-3-small',
    });
  });

  it('returns false when API key is missing', async () => {
    (mockConfig.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...fakeSettings,
      aiApiKey: '',
    });
    const result = await adapter.initialize();
    expect(result).toBe(false);
    expect(adapter.isReady()).toBe(false);
  });

  it('returns false when API call fails', async () => {
    mockAI.callEmbedding.mockRejectedValue(new Error('network error'));
    const result = await adapter.initialize();
    expect(result).toBe(false);
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
