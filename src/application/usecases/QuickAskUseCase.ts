import { QuickAskRequest, QuickAskResult } from '../../domain/models/QuickAskModels';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { TagName, createTagName } from '../../domain/values/TagName';
import { AIProviderPort } from '../ports/AIProviderPort';
import { VaultAccessPort } from '../ports/VaultAccessPort';
import { SearchIndexPort, SearchResult } from '../ports/SearchIndexPort';
import { HistoryPort } from '../ports/HistoryPort';
import { ConfigPort } from '../ports/ConfigPort';
import { ClockPort } from '../ports/ClockPort';
import { PrivacyRule } from '../../domain/models/PrivacyRule';
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

  private buildPrompt(question: string, chunks: ReadonlyArray<any>): string {
    // 구현 상세는 PromptTemplates로 위임
    throw new Error('구현 예정');
  }

  private isChunkAllowed(chunk: any, rules: any[]): boolean {
    // PrivacyRule 검증 로직
    throw new Error('구현 예정');
  }

  private extractLinkSuggestions(content: string): any[] {
    // [[wikilink]] 패턴 추출
    throw new Error('구현 예정');
  }

  private formatAnswer(question: string, answer: string, tags: any[]): string {
    // 마크다운 포맷 구성
    throw new Error('구현 예정');
  }
}
