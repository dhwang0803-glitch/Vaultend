import { QuickAskRequest, QuickAskResult } from '../../domain/models/QuickAskModels';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { TagName, createTagName } from '../../domain/values/TagName';
import { NotePath } from '../../domain/values/NotePath';
import { AIProviderPort } from '../ports/AIProviderPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort, SearchResult } from '../ports/SearchIndexPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ConfigPort } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { PrivacyRule, isNoteAllowedByRules } from '../../domain/models/PrivacyRule';
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
    // 1. 관련 컨텍스트 검색
    const contextChunks = await this.searchIndex.search(
      request.question,
      request.maxContextChunks,
    );

    // 2. 프라이버시 규칙 적용
    const settings = await this.config.getSettings();
    const filteredChunks = contextChunks.filter(chunk =>
      this.isChunkAllowed(chunk, [...settings.privacyRules])
    );

    // 3. AI 호출
    const prompt = this.buildPrompt(request.question, filteredChunks);
    const aiResponse = await this.aiProvider.callCompletion({
      prompt,
      maxTokens: settings.aiMaxTokens,
      temperature: settings.aiTemperature,
    });

    // 4. 응답 파싱 — 태그/링크 추출
    const suggestedTags: ReadonlyArray<TagName> = request.autoTag
      ? (await this.aiProvider.callClassification({
          text: aiResponse.content,
          task: 'suggest-tags',
          existingTags: settings.knownTags,
        })).suggestedTags.map(t => createTagName(t))
      : [];

    const suggestedLinks = request.autoLink
      ? this.extractLinkSuggestions(aiResponse.content)
      : [];

    // 5. 노트 저장
    const content = this.formatAnswer(request.question, aiResponse.content, [...suggestedTags]);
    const savedPath = await this.saveNote.execute({
      content,
      target: request.saveTarget,
      tags: suggestedTags,
      links: suggestedLinks,
    });

    // 6. 이력 기록
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

  private buildPrompt(question: string, chunks: ReadonlyArray<SearchResult>): string {
    const noteChunks = chunks.map(sr => sr.chunk);
    return PromptTemplates.quickAsk(question, noteChunks);
  }

  private isChunkAllowed(result: SearchResult, rules: ReadonlyArray<PrivacyRule>): boolean {
    return isNoteAllowedByRules(result.notePath as string, [], [], rules);
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
