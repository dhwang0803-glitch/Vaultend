import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse,
         EmbeddingRequest, EmbeddingResponse,
         TagDetail } from '../../application/ports/AIProviderPort';
import { AIProviderError, AIParseError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';
import { detectContentLanguage } from '../../application/utils/detectContentLanguage';
import { getModelPricing, estimateCostFromPricing } from '../../domain/models/PricingTable';

export class GeminiAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 2000;
  private rateLimitedUntil = 0;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async callCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const contents = request.messages
      ? request.messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
            parts: [{ text: m.content }],
          }))
      : [{ parts: [{ text: request.prompt }] }];

    const systemInstruction = request.messages
      ? (() => {
          const sysMsg = request.messages!.find(m => m.role === 'system');
          return sysMsg ? { parts: [{ text: sysMsg.content }] } : undefined;
        })()
      : request.systemPrompt
        ? { parts: [{ text: request.systemPrompt }] }
        : undefined;

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      ...(systemInstruction ? { systemInstruction } : {}),
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
    const lang = request.locale ?? detectContentLanguage(request.text);
    const prompt = PromptTemplates.classificationUserMessage(request.text, request.existingTags, request.locale);
    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: PromptTemplates.classificationSystemPrompt(lang),
      maxTokens: 1000,
      temperature: 0.1,
      jsonMode: true,
    });

    const parsed = await this.parseJsonWithRetry(completionResponse.content, prompt);
    const { tags, details } = this.parseTagsWithDetails(parsed.tags, request.existingTags);
    return {
      category: (parsed.category as string) ?? '',
      suggestedTags: tags,
      summary: (parsed.summary as string) ?? '',
      confidence: (parsed.confidence as number) ?? 0.5,
      tokenUsage: completionResponse.tokenUsage,
      tagDetails: details.length > 0 ? details : undefined,
    };
  }

  async callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? 'gemini-embedding-001';
    const requests = request.texts.map(text => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }));

    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:batchEmbedContents?key=${this.apiKey}`;
    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    };

    const response = await this.requestWithRetry(params);
    const result = response.json as { embeddings: Array<{ values: number[] }> };

    const embeddings = result.embeddings.map(e => new Float32Array(e.values));
    const dimension = embeddings.length > 0 ? embeddings[0].length : 0;

    const estimatedTokens = request.texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);

    return {
      embeddings,
      dimension,
      tokenUsage: {
        promptTokens: estimatedTokens,
        completionTokens: 0,
        totalTokens: estimatedTokens,
        estimatedCostUsd: 0,
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
        throw new AIParseError('Gemini', content);
      }
    }
  }

  private async requestWithRetry(params: RequestUrlParam) {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      throw new RateLimitError(this.rateLimitedUntil - now);
    }

    let lastError: unknown;
    let lastRetryAfterMs = 60_000;
    for (let attempt = 0; attempt <= GeminiAdapter.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl(params);
        if (response.status === 200) return response;

        if (response.status === 429) {
          lastRetryAfterMs = this.parseRetryAfter(response.headers);
          this.rateLimitedUntil = Date.now() + lastRetryAfterMs;
          throw new RateLimitError(lastRetryAfterMs);
        } else if (response.status === 503) {
          lastError = new AIProviderError('Gemini', response.status, 'retryable');
        } else {
          throw new AIProviderError('Gemini', response.status, JSON.stringify(response.json));
        }
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        if (err instanceof AIProviderError && !this.isRetryable(err)) throw err;

        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isRetryableMessage(msg) && !(err instanceof AIProviderError)) {
          throw new AIProviderError('Gemini', 0, msg);
        }
      }

      if (attempt < GeminiAdapter.MAX_RETRIES) {
        const backoff = GeminiAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
        await this.sleep(backoff);
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
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
    return new Promise(resolve => window.setTimeout(resolve, ms));
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

  private mapFinishReason(reason?: string): 'stop' | 'length' | 'content_filter' {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      default: return 'stop';
    }
  }

  private estimateCost(promptTokens: number, completionTokens: number): number {
    const pricing = getModelPricing('gemini', this.model);
    return estimateCostFromPricing(pricing, promptTokens, completionTokens);
  }
}
