import { EmbeddingPort } from '../../application/ports/EmbeddingPort';
import { AIProviderPort } from '../../application/ports/AIProviderPort';

export class AIEmbeddingAdapter implements EmbeddingPort {
  private ready = false;
  private dimension = 0;
  private model: string | undefined;

  constructor(
    private readonly aiProvider: AIProviderPort,
  ) {}

  setModel(model: string): void {
    this.model = model || undefined;
  }

  async initialize(): Promise<boolean> {
    try {
      const response = await this.aiProvider.callEmbedding({
        texts: ['test'],
        model: this.model,
      });

      if (response.dimension <= 0 || response.embeddings.length === 0) {
        this.ready = false;
        return false;
      }

      this.dimension = response.dimension;
      this.ready = true;
      return true;
    } catch (err) {
      console.error('Vaultend: embedding initialization failed', err);
      this.ready = false;
      throw err;
    }
  }

  initializeWithKnownDimension(dimension: number): void {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      this.ready = false;
      return;
    }
    this.dimension = dimension;
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.ready) throw new Error('Embedding not initialized');
    const response = await this.aiProvider.callEmbedding({
      texts: [text],
      model: this.model,
    });
    return response.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.ready) throw new Error('Embedding not initialized');
    const response = await this.aiProvider.callEmbedding({
      texts,
      model: this.model,
    });
    return [...response.embeddings];
  }

  getDimension(): number {
    return this.dimension;
  }
}
