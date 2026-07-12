import { TokenUsage } from '../../domain/models/QuickAskModels';

/**
 * AI 공급자 포트 — LLM API와의 통신을 추상화한다.
 *
 * OpenAI, Gemini 등 구체적 공급자는 이 인터페이스를 구현하여
 * 애플리케이션 계층과 분리된다.
 */
export interface AIProviderPort {
  /**
   * 일반 완성(completion) 요청.
   * Quick Ask의 핵심 AI 호출에 사용된다.
   */
  callCompletion(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * 분류/태깅 전용 요청.
   * 노트 분류, 태그 제안 등 구조화된 응답이 필요한 경우.
   */
  callClassification(request: ClassificationRequest): Promise<ClassificationResponse>;
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
}

export interface ClassificationResponse {
  readonly category: string;
  readonly suggestedTags: ReadonlyArray<string>;
  readonly suggestedFolder?: string;
  readonly summary: string;
  readonly confidence: number;
  readonly tokenUsage: TokenUsage;
}
