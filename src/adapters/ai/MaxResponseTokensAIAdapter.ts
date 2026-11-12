import type { AIProviderPort, CompletionRequest, CompletionResponse,
  ClassificationRequest, ClassificationResponse,
  EmbeddingRequest, EmbeddingResponse } from '../../application/ports/AIProviderPort';
import type { ConfigPort } from '../../application/ports/ConfigPort';

/**
 * 사용자 설정 "최대 응답 토큰"(aiMaxTokens)을 모든 completion 호출의 상한으로 적용하는 데코레이터.
 *
 * 각 호출 지점은 출력 형식에 맞춘 고정 한도(링크 300, 요약 ≤2000, 태그·inbox ≤4000 등)를
 * 의도적으로 지정한다. 이 데코레이터는 그 값을 대체하지 않고 min(호출 한도, 설정값)으로
 * 상한만 씌운다 — 기본값(8192)에서는 어떤 호출도 바뀌지 않는다.
 *
 * 분류(callClassification)는 어댑터 내부 고정 한도(400, JSON 복구 500)를 쓰며
 * 설정 하한(1024)보다 항상 작아 상한이 걸리지 않으므로 그대로 위임한다.
 * reasoning/thinking 모델의 추가 예산(OpenAI ×4, Gemini headroom)은 각 어댑터가
 * 상한 적용 후의 응답 예산 위에 더한다.
 */
export class MaxResponseTokensAIAdapter implements AIProviderPort {
  /** 설정 UI 슬라이더 범위와 동일 — data.json 수동 편집 등 범위 밖 값 방어 */
  static readonly MIN_LIMIT = 1024;
  static readonly MAX_LIMIT = 16384;

  constructor(
    private readonly inner: AIProviderPort,
    private readonly config: ConfigPort,
  ) {}

  static effectiveMaxTokens(requested: number, configured: unknown): number {
    if (typeof configured !== 'number' || !Number.isFinite(configured)) return requested;
    const limit = Math.min(
      MaxResponseTokensAIAdapter.MAX_LIMIT,
      Math.max(MaxResponseTokensAIAdapter.MIN_LIMIT, Math.floor(configured)),
    );
    return Math.min(requested, limit);
  }

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const settings = await this.config.getSettings();
    const maxTokens = MaxResponseTokensAIAdapter.effectiveMaxTokens(request.maxTokens, settings.aiMaxTokens);
    return this.inner.callCompletion(maxTokens === request.maxTokens ? request : { ...request, maxTokens });
  }

  callClassification(request: ClassificationRequest): Promise<ClassificationResponse> {
    return this.inner.callClassification(request);
  }

  callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.inner.callEmbedding(request);
  }
}
