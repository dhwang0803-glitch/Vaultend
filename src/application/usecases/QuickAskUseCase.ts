import { QuickAskRequest, QuickAskResult } from '../../domain/models/QuickAskModels';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { TagName, createTagName, sanitizeTagName } from '../../domain/values/TagName';
import { NotePath } from '../../domain/values/NotePath';
import { AIProviderPort } from '../ports/AIProviderPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort, SearchResult } from '../ports/SearchIndexPort';
import { EmbeddingPort } from '../ports/EmbeddingPort';
import { VectorStorePort } from '../ports/VectorStorePort';
import { HistoryPort } from '../ports/HistoryPort';
import { ConfigPort } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { PrivacyRule, isNoteAllowedByRules, applyContentRedaction } from '../../domain/models/PrivacyRule';
import { PromptTemplates } from '../PromptTemplates';
import { SaveNoteUseCase } from './SaveNoteUseCase';

export class QuickAskUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly vault: VaultAccessPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly history: HistoryPort,
    private readonly config: ConfigPort,
    private readonly clock: ClockPort,
    private readonly saveNote: SaveNoteUseCase,
    private readonly embedding?: EmbeddingPort,
    private readonly vectorStore?: VectorStorePort,
  ) {}

  /**
   * Quick Ask 파이프라인을 실행한다.
   *
   * 1. 질문에 대해 검색 인덱스에서 관련 청크를 검색
   * 2. 프라이버시 규칙에 따라 컨텍스트 필터링
   * 3. 프롬프트를 구성하여 AI API 호출
   * 4. 응답을 파싱하여 태그/링크 추출
   * 5. SaveTarget에 따라 노트 저장
   * 6. 이력 기록
   */
  async execute(request: QuickAskRequest): Promise<QuickAskResult> {
    // 1. Search relevant context (hybrid BM25 + vector if available)
    const contextChunks = await this.hybridSearch(
      request.question,
      request.maxContextChunks,
    );

    // 2. Apply privacy rules
    const settings = await this.config.getSettings();
    const allowedChecks = await Promise.all(
      contextChunks.map(chunk => this.isChunkAllowed(chunk, [...settings.privacyRules]))
    );
    const filteredChunks = contextChunks.filter((_, i) => allowedChecks[i]);

    // 3. Call AI after content-redact
    const redactedChunks = filteredChunks.map(sr => ({
      ...sr,
      chunk: { ...sr.chunk, text: applyContentRedaction(sr.chunk.text as string, [...settings.privacyRules]) as typeof sr.chunk.text },
    }));
    const prompt = this.buildPrompt(request.question, redactedChunks);
    const aiResponse = await this.aiProvider.callCompletion({
      prompt,
      maxTokens: settings.aiMaxTokens,
      temperature: settings.aiTemperature,
    });

    // 4. Parse response — extract tags/links
    const suggestedTags: ReadonlyArray<TagName> = request.autoTag
      ? [...new Set(
          (await this.aiProvider.callClassification({
            text: aiResponse.content,
            task: 'suggest-tags',
            existingTags: settings.knownTags,
          })).suggestedTags
            .map(t => sanitizeTagName(t))
            .filter(t => /^#[\w가-힣\-/]+$/.test(t)),
        )].map(t => createTagName(t))
      : [];

    const suggestedLinks = request.autoLink
      ? this.extractLinkSuggestions(aiResponse.content)
      : [];

    // 5. Save note
    const content = this.formatAnswer(request.question, aiResponse.content, [...suggestedTags]);
    const savedPath = await this.saveNote.execute({
      content,
      target: request.saveTarget,
      tags: suggestedTags,
      links: suggestedLinks,
    });

    // 6. Record history
    const now = this.clock.now();
    await this.history.record({
      id: crypto.randomUUID(),
      action: 'quick-ask-save',
      notePath: savedPath,
      timestamp: now,
      description: `Quick Ask: "${request.question.substring(0, 50)}..."`,
    });

    // Map SearchResult[] to NoteChunk[] for the result
    const contextChunksUsed: ReadonlyArray<NoteChunk> = filteredChunks.map(
      (sr: SearchResult) => sr.chunk,
    );

    return {
      question: request.question,
      answer: aiResponse.content,
      contextChunksUsed,
      savedTo: savedPath,
      suggestedTags,
      suggestedLinks,
      tokenUsage: aiResponse.tokenUsage,
      timestamp: now,
    };
  }

  private async hybridSearch(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>> {
    const FETCH_SIZE = 20;
    const bm25Results = await this.searchIndex.search(query, FETCH_SIZE);

    if (!this.embedding?.isReady() || !this.vectorStore) {
      return bm25Results.slice(0, maxResults);
    }

    try {
      const settings = await this.config.getSettings();
      const RRF_K = settings.rrfK;
      const embWeight = settings.rrfEmbeddingWeight;

      const queryVector = await this.embedding.embed(query);
      const vectorResults = await this.vectorStore.search(queryVector, FETCH_SIZE);

      const scores = new Map<string, { score: number; result: SearchResult }>();

      for (let i = 0; i < bm25Results.length; i++) {
        const key = `${bm25Results[i].notePath as string}::${bm25Results[i].chunk.startLine}`;
        const existing = scores.get(key);
        const rrfScore = 1 / (RRF_K + i + 1);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scores.set(key, { score: rrfScore, result: bm25Results[i] });
        }
      }

      const vectorOnlyEntries: Array<{ key: string; score: number; vr: typeof vectorResults[number] }> = [];

      for (let i = 0; i < vectorResults.length; i++) {
        const vr = vectorResults[i];
        const key = `${vr.notePath as string}::${vr.chunkIndex}`;
        const rrfScore = embWeight * (1 / (RRF_K + i + 1));
        const existing = scores.get(key);
        if (existing) {
          existing.score += rrfScore;
        } else {
          const bm25Match = bm25Results.find(
            r => r.notePath === vr.notePath && r.chunk.startLine === vr.chunkIndex,
          );
          if (bm25Match) {
            scores.set(key, { score: rrfScore, result: bm25Match });
          } else {
            vectorOnlyEntries.push({ key, score: rrfScore, vr });
          }
        }
      }

      for (const { key, score, vr } of vectorOnlyEntries) {
        if (scores.has(key)) continue;
        const note = await this.vault.readNote(vr.notePath);
        if (!note) continue;
        const chunk = note.chunks.find(c => c.startLine === vr.chunkIndex);
        if (!chunk) continue;
        scores.set(key, { score, result: { notePath: vr.notePath, chunk, score: vr.similarity } });
      }

      const ranked = [...scores.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(entry => entry.result);

      return ranked;
    } catch {
      return bm25Results.slice(0, maxResults);
    }
  }

  private buildPrompt(question: string, chunks: ReadonlyArray<SearchResult>): string {
    const noteChunks = chunks.map(sr => sr.chunk);
    return PromptTemplates.quickAsk(question, noteChunks);
  }

  private async isChunkAllowed(result: SearchResult, rules: ReadonlyArray<PrivacyRule>): Promise<boolean> {
    const note = await this.vault.readNote(result.notePath);
    const tags = note ? note.metadata.tags.map(t => t as string) : [];
    const frontmatterKeys = note ? [...note.metadata.frontmatterKeys] : [];
    return isNoteAllowedByRules(result.notePath as string, tags, frontmatterKeys, rules);
  }

  private extractLinkSuggestions(content: string): ReadonlyArray<NotePath> {
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const links: NotePath[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = wikiLinkPattern.exec(content)) !== null) {
      const linkTarget = match[1].trim();
      if (!seen.has(linkTarget)) {
        seen.add(linkTarget);
        links.push(linkTarget as NotePath);
      }
    }
    return links;
  }

  private formatAnswer(question: string, answer: string, _tags: ReadonlyArray<TagName>): string {
    return `## Question\n\n${question}\n\n## Answer\n\n${answer}`;
  }
}
