import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse,
         EmbeddingRequest, EmbeddingResponse,
         TagDetail } from '../../application/ports/AIProviderPort';
import { AIProviderError, AIParseError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';
import { detectContentLanguage } from '../../application/utils/detectContentLanguage';
import { getModelPricing, getEmbeddingPricing, estimateCostFromPricing, estimateEmbeddingCostFromPricing } from '../../domain/models/PricingTable';

export class OpenAIAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://api.openai.com/v1';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 2000;
  private rateLimitedUntil = 0;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const messages = request.messages
      ? request.messages.map(m => ({ role: m.role, content: m.content }))
      : [
          ...(request.systemPrompt
            ? [{ role: 'system' as const, content: request.systemPrompt }]
            : []),
          { role: 'user' as const, content: request.prompt },
        ];

    const body = {
      model: this.model,
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
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
    const lang = request.locale ?? detectContentLanguage(request.text);
    const prompt = PromptTemplates.classificationUserMessage(request.text, request.existingTags, request.locale, request.availableNotes);

    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: PromptTemplates.classificationSystemPrompt(lang),
      maxTokens: 1000,
      temperature: 0.1,
      jsonMode: true,
    });

    const parsed = await this.parseJsonWithRetry(completionResponse.content, prompt);

    const relatedNotes = Array.isArray(parsed.relatedNotes)
      ? (parsed.relatedNotes as unknown[]).filter((n): n is string => typeof n === 'string')
      : [];
    const { tags, details } = this.parseTagsWithDetails(parsed.tags, request.existingTags);
    return {
      category: (parsed.category as string) ?? '',
      suggestedTags: tags,
      suggestedLinks: relatedNotes,
      summary: (parsed.summary as string) ?? '',
      confidence: (parsed.confidence as number) ?? 0.5,
      tokenUsage: completionResponse.tokenUsage,
      tagDetails: details.length > 0 ? details : undefined,
    };
  }

  async callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? 'text-embedding-3-small';
    const body = {
      model,
      input: request.texts,
    };

    const response = await this.makeRequest('/embeddings', body) as {
      data: Array<{ embedding: number[] }>;
      usage: { prompt_tokens: number; total_tokens: number };
    };

    const embeddings = response.data.map(d => new Float32Array(d.embedding));
    const dimension = embeddings.length > 0 ? embeddings[0].length : 0;

    return {
      embeddings,
      dimension,
      tokenUsage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: 0,
        totalTokens: response.usage.total_tokens,
        estimatedCostUsd: estimateEmbeddingCostFromPricing(
          getEmbeddingPricing('openai', model), response.usage.total_tokens,
        ),
      },
    };
  }

  private async parseJsonWithRetry(content: string, originalPrompt: string): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(this.stripCodeBlock(content));
    } catch {
      const repairResponse = await this.callCompletion({
        prompt: `Your previous response was not valid JSON. The original request was:\n\n${originalPrompt}\n\nRespond ONLY with valid JSON. No markdown, no code blocks, no explanation.`,
        systemPrompt: 'You must respond with valid JSON only. No other text.',
        maxTokens: 500,
        temperature: 0.1,
        jsonMode: true,
      });

      try {
        return JSON.parse(this.stripCodeBlock(repairResponse.content));
      } catch {
        throw new AIParseError('OpenAI', content);
      }
    }
  }

  private parseTagsWithDetails(
    rawTags: unknown,
    existingTags?: ReadonlyArray<string>,
  ): { tags: string[]; details: TagDetail[] } {
    if (!Array.isArray(rawTags)) return { tags: [], details: [] };

    const TAG_SCORE_THRESHOLD = 70;
    const existingSet = new Set((existingTags ?? []).map(t => t.toLowerCase()));

    if (rawTags.length > 0 && typeof rawTags[0] === 'object' && rawTags[0] !== null) {
      const tags: string[] = [];
      const details: TagDetail[] = [];

      for (const item of rawTags as Array<Record<string, unknown>>) {
        if (typeof item.tag !== 'string') continue;

        const rawScore = typeof item.score === 'number' ? item.score
          : typeof item.confidence === 'number' ? Math.round(item.confidence * 100)
          : 100;
        const score = Math.min(100, Math.max(0, rawScore));
        if (score < TAG_SCORE_THRESHOLD) continue;

        const isNew = typeof item.isNew === 'boolean' ? item.isNew
          : !existingSet.has(item.tag.toLowerCase());
        const reason = typeof item.reason === 'string' ? item.reason : '';

        tags.push(item.tag);
        details.push({ tag: item.tag, score, isNew, reason });
      }
      return { tags, details };
    }

    const tags = rawTags.filter((t): t is string => typeof t === 'string');
    return { tags, details: [] };
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
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      throw new RateLimitError(this.rateLimitedUntil - now);
    }

    let lastError: unknown;
    let lastRetryAfterMs = 60_000;
    for (let attempt = 0; attempt <= OpenAIAdapter.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl(params);
        if (response.status === 200) return response.json;

        if (response.status === 429) {
          lastRetryAfterMs = this.parseRetryAfter(response.headers);
          this.rateLimitedUntil = Date.now() + lastRetryAfterMs;
          throw new RateLimitError(lastRetryAfterMs);
        } else if (response.status === 503) {
          lastError = new AIProviderError('OpenAI', response.status, 'retryable');
        } else {
          throw new AIProviderError('OpenAI', response.status, JSON.stringify(response.json));
        }
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        if (err instanceof AIProviderError && !this.isRetryable(err)) throw err;

        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isRetryableMessage(msg) && !(err instanceof AIProviderError)) {
          throw new AIProviderError('OpenAI', 0, msg);
        }
      }

      if (attempt < OpenAIAdapter.MAX_RETRIES) {
        const backoff = OpenAIAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
        await this.sleep(backoff);
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
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
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  private estimateCost(promptTokens: number, completionTokens: number): number {
    const pricing = getModelPricing('openai', this.model);
    return estimateCostFromPricing(pricing, promptTokens, completionTokens);
  }
}
