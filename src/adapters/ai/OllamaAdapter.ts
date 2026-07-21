import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIProviderPort, CompletionRequest, CompletionResponse,
         ClassificationRequest, ClassificationResponse,
         EmbeddingRequest, EmbeddingResponse,
         TagDetail } from '../../application/ports/AIProviderPort';
import { AIProviderError, AIParseError } from '../../domain/errors/DomainErrors';
import { PromptTemplates } from '../../application/PromptTemplates';
import { detectContentLanguage } from '../../application/utils/detectContentLanguage';

export class OllamaAdapter implements AIProviderPort {
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_BASE_MS = 1000;

  constructor(
    private readonly baseUrl: string,
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

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      options: {
        num_predict: request.maxTokens,
        temperature: request.temperature,
      },
    };

    if (request.jsonMode) {
      body.format = 'json';
    }

    const response = await this.makeRequest('/api/chat', body) as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    const promptTokens = response.prompt_eval_count ?? 0;
    const completionTokens = response.eval_count ?? 0;

    return {
      content: response.message.content,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: 0,
      },
      finishReason: 'stop',
    };
  }

  async callClassification(request: ClassificationRequest): Promise<ClassificationResponse> {
    const lang = request.locale ?? detectContentLanguage(request.text);
    const prompt = PromptTemplates.classificationUserMessage(request.text, request.existingTags, request.locale);

    const completionResponse = await this.callCompletion({
      prompt,
      systemPrompt: PromptTemplates.classificationSystemPrompt(lang),
      maxTokens: 400,
      temperature: 0.1,
      jsonMode: true,
    });

    const parsed = this.parseJson(completionResponse.content);

    const { tags, details } = this.parseTagsWithDetails(parsed.tags, request.existingTags);
    return {
      category: (parsed.category as string) ?? '',
      suggestedTags: tags,
      summary: (parsed.summary as string) ?? '',
      confidence: (parsed.confidence as number) ?? 1.0,
      tokenUsage: completionResponse.tokenUsage,
      tagDetails: details.length > 0 ? details : undefined,
      onelineSummary: typeof parsed.onelineSummary === 'string' ? parsed.onelineSummary : undefined,
    };
  }

  async callEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? 'nomic-embed-text';

    const embeddings: Float32Array[] = [];
    let totalTokens = 0;

    for (const text of request.texts) {
      const body = { model, input: text };
      const response = await this.makeRequest('/api/embed', body) as {
        embeddings: number[][];
        prompt_eval_count?: number;
      };

      if (response.embeddings && response.embeddings.length > 0) {
        embeddings.push(new Float32Array(response.embeddings[0]));
      }
      totalTokens += response.prompt_eval_count ?? 0;
    }

    const dimension = embeddings.length > 0 ? embeddings[0].length : 0;

    return {
      embeddings,
      dimension,
      tokenUsage: {
        promptTokens: totalTokens,
        completionTokens: 0,
        totalTokens,
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
      throw new AIParseError('Ollama', content);
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

  private async makeRequest(endpoint: string, body: unknown): Promise<unknown> {
    const params: RequestUrlParam = {
      url: `${this.baseUrl}${endpoint}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };

    return this.requestWithRetry(params);
  }

  private async requestWithRetry(params: RequestUrlParam): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= OllamaAdapter.MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl(params);
        if (response.status === 200) return response.json;
        throw new AIProviderError('Ollama', response.status, JSON.stringify(response.json));
      } catch (err) {
        if (err instanceof AIProviderError) throw err;
        lastError = err;

        if (attempt < OllamaAdapter.MAX_RETRIES) {
          const backoff = OllamaAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
          await new Promise(resolve => window.setTimeout(resolve, backoff));
        }
      }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new AIProviderError('Ollama', 0, `Connection failed after retries: ${msg}. Is Ollama running at ${this.baseUrl}?`);
  }
}
