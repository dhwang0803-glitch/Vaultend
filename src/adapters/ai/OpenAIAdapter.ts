import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';

export class OpenAIAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://api.openai.com/v1';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 2000;

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
    const prompt = PromptTemplates.classifyAndTag(request.text, request.existingTags ?? [], request.currentNoteTags, request.existingFolders);

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
    const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
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

    return this.requestWithRetry(params);
  }

  private async requestWithRetry(params: RequestUrlParam) {
    let lastError: unknown;
    let lastRetryAfterMs = 60_000;
    for (let attempt = 0; attempt <= OpenAIAdapter.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl(params);
        if (response.status === 200) return response.json;

        if (response.status === 429 || response.status === 503) {
          lastRetryAfterMs = this.parseRetryAfter(response.headers);
          lastError = new AIProviderError('OpenAI', response.status, 'retryable');
        } else {
          throw new AIProviderError('OpenAI', response.status, JSON.stringify(response.json));
        }
      } catch (err) {
        if (err instanceof AIProviderError && !this.isRetryable(err)) throw err;

        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isRetryableMessage(msg) && !(err instanceof AIProviderError)) {
          throw new AIProviderError('OpenAI', 0, msg);
        }
      }

      if (attempt < OpenAIAdapter.MAX_RETRIES) {
        const backoff = OpenAIAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
        const delay = Math.max(backoff, lastRetryAfterMs);
        await this.sleep(delay);
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    if (msg.includes('429')) throw new RateLimitError(lastRetryAfterMs);
    throw new AIProviderError('OpenAI', 0, `${OpenAIAdapter.MAX_RETRIES}회 재시도 후 실패: ${msg}`);
  }

  private parseRetryAfter(headers: Record<string, string>): number {
    const value = headers['retry-after'] ?? headers['Retry-After'];
    if (!value) return 60_000;
    const seconds = parseFloat(value);
    if (isNaN(seconds) || seconds <= 0) return 60_000;
    return Math.ceil(seconds * 1000);
  }

  private isRetryable(err: AIProviderError): boolean {
    return err.statusCode === 429 || err.statusCode === 503;
  }

  private isRetryableMessage(msg: string): boolean {
    return msg.includes('429') || msg.includes('503');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private estimateCost(promptTokens: number, completionTokens: number): number {
    const promptCost = (promptTokens / 1_000_000) * 2.50;
    const completionCost = (completionTokens / 1_000_000) * 10.00;
    return promptCost + completionCost;
  }
}
