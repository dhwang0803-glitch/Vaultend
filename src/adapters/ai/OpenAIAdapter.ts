import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';

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

    const response = await this.makeRequest('/chat/completions', body) as {
      choices: Array<{ message: { content: string }; finish_reason: 'stop' | 'length' | 'content_filter' }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

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
    const prompt = PromptTemplates.classifyAndTag(request.text, request.existingTags ?? []);

    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: PromptTemplates.classificationSystemPrompt,
      maxTokens: 500,
      temperature: 0.3,
    });

    const parsed = JSON.parse(this.stripCodeBlock(completionResponse.content));

    return {
      category: parsed.category ?? '미분류',
      suggestedTags: parsed.tags ?? [],
      suggestedFolder: parsed.folder,
      summary: parsed.summary ?? '',
      confidence: parsed.confidence ?? 0.5,
      tokenUsage: completionResponse.tokenUsage,
    };
  }

  private stripCodeBlock(text: string): string {
    const trimmed = text.trim();
    const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    return match ? match[1].trim() : trimmed;
  }

  private async makeRequest(endpoint: string, body: unknown): Promise<unknown> {
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

  private estimateCost(promptTokens: number, completionTokens: number): number {
    // GPT-4o 기준 대략적 비용 (모델별 분기 필요)
    const promptCost = (promptTokens / 1_000_000) * 2.50;
    const completionCost = (completionTokens / 1_000_000) * 10.00;
    return promptCost + completionCost;
  }
}
