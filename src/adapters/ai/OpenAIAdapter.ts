import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse,
         EmbeddingRequest, EmbeddingResponse } from '../../application/ports/AIProviderPort';
import { AIProviderError, AIParseError, RateLimitError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';
import { detectContentLanguage } from '../../application/utils/detectContentLanguage';

export class OpenAIAdapter implements AIProviderPort {
  private static readonly BASE_URL = 'https://api.openai.com/v1';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 2000;

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
    const prompt = PromptTemplates.classifyAndTag(request.text, request.existingTags ?? [], request.currentNoteTags, request.existingFolders, request.currentFolder, request.locale);

    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: PromptTemplates.classificationSystemPrompt(lang),
      maxTokens: 500,
      temperature: 0.3,
      jsonMode: true,
    });

    const parsed = await this.parseJsonWithRetry(completionResponse.content, prompt);

    const folder = (parsed.folder as string) || undefined;
    return {
      category: (parsed.category as string) ?? folder ?? '미분류',
      suggestedTags: this.parseTagsWithConfidence(parsed.tags),
      suggestedFolder: folder,
      summary: (parsed.summary as string) ?? '',
      confidence: (parsed.confidence as number) ?? 0.5,
      tokenUsage: completionResponse.tokenUsage,
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
        estimatedCostUsd: (response.usage.total_tokens / 1_000_000) * 0.02,
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

  private parseTagsWithConfidence(rawTags: unknown): string[] {
    if (!Array.isArray(rawTags)) return [];

    const TAG_CONFIDENCE_THRESHOLD = 0.7;

    if (rawTags.length > 0 && typeof rawTags[0] === 'object' && rawTags[0] !== null) {
      return (rawTags as Array<{ tag: string; confidence?: number }>)
        .filter(t => typeof t.tag === 'string' && (t.confidence ?? 1) >= TAG_CONFIDENCE_THRESHOLD)
        .map(t => t.tag);
    }

    return rawTags.filter((t): t is string => typeof t === 'string');
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
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  private estimateCost(promptTokens: number, completionTokens: number): number {
    const promptCost = (promptTokens / 1_000_000) * 2.50;
    const completionCost = (completionTokens / 1_000_000) * 10.00;
    return promptCost + completionCost;
  }
}
