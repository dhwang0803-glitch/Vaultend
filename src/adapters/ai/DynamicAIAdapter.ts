import type { AIProviderPort, CompletionRequest, CompletionResponse,
  ClassificationRequest, ClassificationResponse,
  EmbeddingRequest, EmbeddingResponse } from '../../application/ports/AIProviderPort';
import type { ConfigPort } from '../../application/ports/ConfigPort';
import { OpenAIAdapter } from './OpenAIAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { OllamaAdapter } from './OllamaAdapter';
import { OpenAICompatAdapter } from './OpenAICompatAdapter';

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
    const key = this.buildCacheKey(settings);
    if (this.cachedAdapter && this.cachedKey === key) {
      return this.cachedAdapter;
    }

    switch (settings.aiProvider) {
      case 'gemini':
        this.cachedAdapter = new GeminiAdapter(settings.aiApiKey, settings.aiModel);
        break;
      case 'ollama':
        this.cachedAdapter = new OllamaAdapter(
          settings.ollamaBaseUrl || 'http://localhost:11434',
          settings.aiModel || 'llama3.2',
        );
        break;
      case 'deepseek':
        this.cachedAdapter = new OpenAICompatAdapter(
          'https://api.deepseek.com',
          settings.deepseekApiKey || settings.aiApiKey,
          settings.deepseekModel || 'deepseek-chat',
          'DeepSeek',
          false,
        );
        break;
      case 'custom':
        this.cachedAdapter = new OpenAICompatAdapter(
          settings.customBaseUrl,
          settings.customApiKey,
          settings.customModel,
          'custom',
          true,
        );
        break;
      default:
        this.cachedAdapter = new OpenAIAdapter(settings.aiApiKey, settings.aiModel);
    }
    this.cachedKey = key;
    return this.cachedAdapter;
  }

  private buildCacheKey(settings: { aiProvider: string; aiApiKey: string; aiModel: string; ollamaBaseUrl: string; deepseekApiKey: string; deepseekModel: string; customBaseUrl: string; customApiKey: string; customModel: string }): string {
    switch (settings.aiProvider) {
      case 'ollama':
        return `ollama:${settings.ollamaBaseUrl}:${settings.aiModel}`;
      case 'deepseek':
        return `deepseek:${settings.deepseekApiKey || settings.aiApiKey}:${settings.deepseekModel}`;
      case 'custom':
        return `custom:${settings.customBaseUrl}:${settings.customApiKey}:${settings.customModel}`;
      default:
        return `${settings.aiProvider}:${settings.aiApiKey}:${settings.aiModel}`;
    }
  }
}
