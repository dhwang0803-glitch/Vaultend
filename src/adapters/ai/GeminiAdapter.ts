import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';

export class GeminiAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 2000;

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

    const response = await this.requestWithRetry(params);
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

  private async requestWithRetry(params: RequestUrlParam) {
    let lastError: unknown;
    let lastRetryAfterMs = 60_000;
    for (let attempt = 0; attempt <= GeminiAdapter.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl(params);
        if (response.status === 200) return response;

        if (response.status === 429 || response.status === 503) {
          lastRetryAfterMs = this.parseRetryAfter(response.headers);
          lastError = new AIProviderError('Gemini', response.status, 'retryable');
        } else {
          throw new AIProviderError('Gemini', response.status, JSON.stringify(response.json));
        }
      } catch (err) {
        if (err instanceof AIProviderError && !this.isRetryable(err)) throw err;

        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isRetryableMessage(msg) && !(err instanceof AIProviderError)) {
          throw new AIProviderError('Gemini', 0, msg);
        }
      }

      if (attempt < GeminiAdapter.MAX_RETRIES) {
        const backoff = GeminiAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
        const delay = Math.max(backoff, lastRetryAfterMs);
        await this.sleep(delay);
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    if (msg.includes('429')) throw new RateLimitError(lastRetryAfterMs);
    throw new AIProviderError('Gemini', 0, `${GeminiAdapter.MAX_RETRIES}회 재시도 후 실패: ${msg}`);
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

  private stripCodeBlock(text: string): string {
    const trimmed = text.trim();
    const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
    return match ? match[1].trim() : trimmed;
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
    const promptCost = (promptTokens / 1_000_000) * 0.075;
    const completionCost = (completionTokens / 1_000_000) * 0.30;
    return promptCost + completionCost;
  }
}
