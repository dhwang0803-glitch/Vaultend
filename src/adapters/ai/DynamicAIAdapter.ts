import type { AIProviderPort, CompletionRequest, CompletionResponse,
  ClassificationRequest, ClassificationResponse,
  EmbeddingRequest, EmbeddingResponse } from '../../application/ports/AIProviderPort';
import type { ConfigPort } from '../../application/ports/ConfigPort';
import { OpenAIAdapter } from './OpenAIAdapter';
import { GeminiAdapter } from './GeminiAdapter';

export class DynamicAIAdapter implements AIProviderPort {
  private cachedAdapter: AIProviderPort | null = null;
  private cachedKey = '';

  constructor(private readonly config: ConfigPort) {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const adapter = await this.resolveAdapter();
    return adapter.callCompletion(request);
  }

  async callClassification(request: ClassificationRequest): Promise<ClassificationResponse> {
    const adapter = await this.resolveAdapter();
    return adapter.callClassification(request);
  }

  async callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const adapter = await this.resolveAdapter();
    return adapter.callEmbedding(request);
  }

  private async resolveAdapter(): Promise<AIProviderPort> {
    const settings = await this.config.getSettings();
    const key = `${settings.aiProvider}:${settings.aiApiKey}:${settings.aiModel}`;
    if (this.cachedAdapter && this.cachedKey === key) {
      return this.cachedAdapter;
    }

    switch (settings.aiProvider) {
      case 'gemini':
        this.cachedAdapter = new GeminiAdapter(settings.aiApiKey, settings.aiModel);
        break;
      default:
        this.cachedAdapter = new OpenAIAdapter(settings.aiApiKey, settings.aiModel);
    }
    this.cachedKey = key;
    return this.cachedAdapter;
  }
}
