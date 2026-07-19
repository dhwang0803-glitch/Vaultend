import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse,
         EmbeddingRequest, EmbeddingResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, AIParseError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';
import { detectContentLanguage } from '../../application/utils/detectContentLanguage';
import { getModelPricing, estimateCostFromPricing } from '../../domain/models/PricingTable';

export class OpenAICompatAdapter implements AIProviderPort {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 2000;
  private rateLimitedUntil = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly providerName: string = 'custom',
    private readonly embeddingSupported: boolean = true,
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

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    };

    if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.makeRequest('/v1/chat/completions', body) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    const pricing = getModelPricing(this.providerName, this.model);

    return {
      content: response.choices[0].message.content,
      tokenUsage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: estimateCostFromPricing(pricing, usage.prompt_tokens, usage.completion_tokens),
      },
      finishReason: response.choices[0].finish_reason as 'stop' | 'length' | 'content_filter',
    };
  }

  async callClassification(request: ClassificationRequest): Promise<ClassificationResponse> {
    const lang = request.locale ?? detectContentLanguage(request.text);
    const prompt = PromptTemplates.classifyAndTag(
      request.text,
      request.existingTags ?? [],
      request.currentNoteTags,
      request.existingFolders,
      request.currentFolder,
      request.locale,
    );

    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: PromptTemplates.classificationSystemPrompt(lang),
      maxTokens: 500,
      temperature: 0.3,
      jsonMode: true,
    });

    const parsed = this.parseJson(completionResponse.content);

    const folder = (parsed.folder as string) || undefined;
    return {
      category: (parsed.category as string) ?? folder ?? '미분류',
      suggestedTags: this.parseTags(parsed.tags),
      suggestedFolder: folder,
      summary: (parsed.summary as string) ?? '',
      confidence: (parsed.confidence as number) ?? 0.5,
      tokenUsage: completionResponse.tokenUsage,
    };
  }

  async callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.embeddingSupported) {
      return {
        embeddings: [],
        dimension: 0,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      };
    }

    const model = request.model ?? this.model;
    const body = { model, input: request.texts };

    const response = await this.makeRequest('/v1/embeddings', body) as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    const embeddings = response.data.map(d => new Float32Array(d.embedding));
    const dimension = embeddings.length > 0 ? embeddings[0].length : 0;
    const usage = response.usage ?? { prompt_tokens: 0, total_tokens: 0 };

    return {
      embeddings,
      dimension,
      tokenUsage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: 0,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: 0,
      },
    };
  }

  private parseJson(content: string): Record<string, unknown> {
    const trimmed = content.trim();
    const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
    const clean = match ? match[1].trim() : trimmed;
    try {
      return JSON.parse(clean);
    } catch {
      throw new AIParseError(this.providerName, content);
    }
  }

  private parseTags(rawTags: unknown): string[] {
    if (!Array.isArray(rawTags)) return [];
    if (rawTags.length > 0 && typeof rawTags[0] === 'object' && rawTags[0] !== null) {
      return (rawTags as Array<{ tag: string; confidence?: number }>)
        .filter(t => typeof t.tag === 'string' && (t.confidence ?? 1) >= 0.7)
        .map(t => t.tag);
    }
    return rawTags.filter((t): t is string => typeof t === 'string');
  }

  private async makeRequest(endpoint: string, body: unknown): Promise<unknown> {
    const url = this.baseUrl.replace(/\/+$/, '') + endpoint;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };

    return this.requestWithRetry(params);
  }

  private async requestWithRetry(params: RequestUrlParam): Promise<unknown> {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      throw new RateLimitError(this.rateLimitedUntil - now);
    }

    let lastError: unknown;
    let lastRetryAfterMs = 60_000;

    for (let attempt = 0; attempt <= OpenAICompatAdapter.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl(params);
        if (response.status === 200) return response.json;

        if (response.status === 429) {
          lastRetryAfterMs = this.parseRetryAfter(response.headers);
          this.rateLimitedUntil = Date.now() + lastRetryAfterMs;
          throw new RateLimitError(lastRetryAfterMs);
        } else if (response.status === 503) {
          lastError = new AIProviderError(this.providerName, response.status, 'retryable');
        } else {
          throw new AIProviderError(this.providerName, response.status, JSON.stringify(response.json));
        }
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        if (err instanceof AIProviderError && !(err.statusCode === 503)) throw err;
        lastError = err;

        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('503') && !(err instanceof AIProviderError)) {
          throw new AIProviderError(this.providerName, 0, msg);
        }
      }

      if (attempt < OpenAICompatAdapter.MAX_RETRIES) {
        const backoff = OpenAICompatAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise(resolve => window.setTimeout(resolve, backoff));
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new AIProviderError(this.providerName, 0, `${OpenAICompatAdapter.MAX_RETRIES} retries failed: ${msg}`);
  }

  private parseRetryAfter(headers: Record<string, string>): number {
    const value = headers['retry-after'] ?? headers['Retry-After'];
    if (!value) return 60_000;
    const seconds = parseFloat(value);
    if (isNaN(seconds) || seconds <= 0) return 60_000;
    return Math.ceil(seconds * 1000);
  }
}
