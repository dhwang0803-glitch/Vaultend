import { EmbeddingPort } from '../../application/ports/EmbeddingPort';
import { AIProviderPort } from '../../application/ports/AIProviderPort';
import { ConfigPort } from '../../application/ports/ConfigPort';

export class AIEmbeddingAdapter implements EmbeddingPort {
  private ready = false;
  private dimension = 0;

  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly config: ConfigPort,
  ) {}

  async initialize(): Promise<boolean> {
    try {
      const settings = await this.config.getSettings();
      if (!settings.aiApiKey) return false;

      const response = await this.aiProvider.callEmbedding({
        texts: ['test'],
      });

      this.dimension = response.dimension;
      this.ready = true;
      return true;
    } catch (err) {
      console.error('Knowledge Maintenance: embedding initialization failed', err);
      this.ready = false;
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.ready) throw new Error('Embedding not initialized');
    const response = await this.aiProvider.callEmbedding({
      texts: [text],
    });
    return response.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.ready) throw new Error('Embedding not initialized');
    const response = await this.aiProvider.callEmbedding({
      texts,
    });
    return [...response.embeddings];
  }

  getDimension(): number {
    return this.dimension;
  }
}
