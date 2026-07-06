import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, RateLimitError } from '../../domain/errors/DomainErrors';

/**
 * OpenAI API 어댑터.
 *
 * 주의: Obsidian 모바일 호환성을 위해 반드시 requestUrl()을 사용한다.
 * fetch()나 request()는 모바일에서 동작하지 않을 수 있다.
 */
export class OpenAIAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://api.openai.com/v1';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      model: this.model,
      messages: [
        ...(request.systemPrompt
          ? [{ role: 'system' as const, content: request.systemPrompt }]
          : []),
        { role: 'user' as const, content: request.prompt },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    };

    const response = await this.makeRequest('/chat/completions', body);

    return {
      content: response.choices[0].message.content,
      tokenUsage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        estimatedCostUsd: this.estimateCost(
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
        ),
      },
      finishReason: response.choices[0].finish_reason,
    };
  }

  async callClassification(request: ClassificationRequest): Promise<ClassificationResponse> {
    const prompt = this.buildClassificationPrompt(request);

    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: '당신은 노트 분류 및 태깅 전문가입니다. JSON 형식으로만 응답하세요.',
      maxTokens: 500,
      temperature: 0.3,
    });

    // JSON 파싱
    const parsed = JSON.parse(completionResponse.content);

    return {
      category: parsed.category ?? '미분류',
      suggestedTags: parsed.tags ?? [],
      suggestedFolder: parsed.folder,
      summary: parsed.summary ?? '',
      confidence: parsed.confidence ?? 0.5,
      tokenUsage: completionResponse.tokenUsage,
    };
  }

  private async makeRequest(endpoint: string, body: unknown): Promise<any> {
    const params: RequestUrlParam = {
      url: `${OpenAIAdapter.BASE_URL}${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    };

    try {
      const response = await requestUrl(params);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] ?? '60', 10) * 1000;
        throw new RateLimitError(retryAfter);
      }

      if (response.status !== 200) {
        throw new AIProviderError('OpenAI', response.status, JSON.stringify(response.json));
      }

      return response.json;
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof AIProviderError) {
        throw err;
      }
      throw new AIProviderError('OpenAI', 0, err instanceof Error ? err.message : String(err));
    }
  }

  private buildClassificationPrompt(request: ClassificationRequest): string {
    const tagsContext = request.existingTags
      ? `\n기존 태그 목록: ${request.existingTags.join(', ')}`
      : '';

    return `다음 노트를 분석하여 JSON으로 응답하세요.${tagsContext}

노트 내용:
---
${request.text}
---

응답 형식:
{
  "category": "카테고리명",
  "tags": ["#태그1", "#태그2"],
  "folder": "추천 폴더 경로 (선택)",
  "summary": "한 줄 요약",
  "confidence": 0.0~1.0
}`;
  }

  private estimateCost(promptTokens: number, completionTokens: number): number {
    // GPT-4o 기준 대략적 비용 (모델별 분기 필요)
    const promptCost = (promptTokens / 1_000_000) * 2.50;
    const completionCost = (completionTokens / 1_000_000) * 10.00;
    return promptCost + completionCost;
  }
}
