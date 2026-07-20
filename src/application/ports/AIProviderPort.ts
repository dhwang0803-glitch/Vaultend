import { TokenUsage } from '../../domain/models/TokenUsage';

export interface AIProviderPort {
  callCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  callClassification(request: ClassificationRequest): Promise<ClassificationResponse>;
  callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface ChatMessageInput {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}

export interface CompletionRequest {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly jsonMode?: boolean;
  readonly messages?: ReadonlyArray<ChatMessageInput>;
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
  readonly locale?: 'en' | 'ko';
}

export interface TagDetail {
  readonly tag: string;
  readonly score: number;
  readonly isNew: boolean;
  readonly reason: string;
}

export interface ClassificationResponse {
  readonly category?: string;
  readonly suggestedTags: ReadonlyArray<string>;
  readonly summary: string;
  readonly confidence: number;
  readonly tokenUsage: TokenUsage;
  readonly tagDetails?: ReadonlyArray<TagDetail>;
  readonly onelineSummary?: string;
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
