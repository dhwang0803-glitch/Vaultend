import { TokenUsage } from '../../domain/models/QuickAskModels';

export interface AIProviderPort {
  callCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  callClassification(request: ClassificationRequest): Promise<ClassificationResponse>;
  callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface CompletionRequest {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly jsonMode?: boolean;
}

export interface CompletionResponse {
  readonly content: string;
  readonly tokenUsage: TokenUsage;
  readonly finishReason: 'stop' | 'length' | 'content_filter';
}

export interface ClassificationRequest {
  readonly text: string;
  readonly task: 'classify-and-tag' | 'suggest-tags' | 'suggest-links' | 'summarize';
  readonly existingTags?: ReadonlyArray<string>;
  readonly existingCategories?: ReadonlyArray<string>;
  readonly currentNoteTags?: ReadonlyArray<string>;
  readonly existingFolders?: ReadonlyArray<string>;
  readonly currentFolder?: string;
  readonly locale?: 'en' | 'ko';
}

export interface ClassificationResponse {
  readonly category: string;
  readonly suggestedTags: ReadonlyArray<string>;
  readonly suggestedFolder?: string;
  readonly summary: string;
  readonly confidence: number;
  readonly tokenUsage: TokenUsage;
}

export interface EmbeddingRequest {
  readonly texts: ReadonlyArray<string>;
  readonly model?: string;
}

export interface EmbeddingResponse {
  readonly embeddings: ReadonlyArray<Float32Array>;
  readonly dimension: number;
  readonly tokenUsage: TokenUsage;
}
