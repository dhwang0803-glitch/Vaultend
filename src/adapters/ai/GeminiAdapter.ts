import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from './PromptTemplates';

/**
 * Google Gemini API 어댑터.
 *
 * Gemini는 OpenAI와 다른 API 구조를 가지므로 별도 어댑터로 구현한다.
 * requestUrl()을 사용하여 모바일 호환성을 보장한다.
 */
export class GeminiAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      contents: [
        {
          parts: [{ text: request.prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
      },
      ...(request.systemPrompt
        ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
        : {}),
    };

    const url = `${GeminiAdapter.BASE_URL}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };

    try {
      const response = await requestUrl(params);

      if (response.status === 429) {
        throw new RateLimitError(60_000);
      }

      if (response.status !== 200) {
        throw new AIProviderError('Gemini', response.status, JSON.stringify(response.json));
      }

      const result = response.json;
      const content = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const usage = result.usageMetadata ?? {};

      return {
        content,
        tokenUsage: {
          promptTokens: usage.promptTokenCount ?? 0,
          completionTokens: usage.candidatesTokenCount ?? 0,
          totalTokens: usage.totalTokenCount ?? 0,
          estimatedCostUsd: this.estimateCost(
            usage.promptTokenCount ?? 0,
            usage.candidatesTokenCount ?? 0,
          ),
        },
        finishReason: this.mapFinishReason(result.candidates?.[0]?.finishReason),
      };
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof AIProviderError) throw err;
      throw new AIProviderError('Gemini', 0, err instanceof Error ? err.message : String(err));
    }
  }

  async callClassification(request: ClassificationRequest): Promise<ClassificationResponse> {
    const prompt = PromptTemplates.classifyAndTag(request.text, request.existingTags ?? []);
    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: '당신은 노트 분류 및 태깅 전문가입니다. JSON 형식으로만 응답하세요.',
      maxTokens: 500,
      temperature: 0.3,
    });

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

  private mapFinishReason(reason?: string): 'stop' | 'length' | 'content_filter' {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      default: return 'stop';
    }
  }

  private estimateCost(promptTokens: number, completionTokens: number): number {
    // Gemini 1.5 Flash 기준 대략적 비용
    const promptCost = (promptTokens / 1_000_000) * 0.075;
    const completionCost = (completionTokens / 1_000_000) * 0.30;
    return promptCost + completionCost;
  }
}
