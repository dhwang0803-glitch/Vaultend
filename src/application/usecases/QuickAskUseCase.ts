import { QuickAskRequest, QuickAskResult, ChatMessage, ChatSession, TokenUsage } from '../../domain/models/QuickAskModels';
import { NoteChunk } from '../../domain/models/NoteChunk';
import { SaveTarget } from '../../domain/models/SaveTarget';
import { TagName, createTagName } from '../../domain/values/TagName';
import { NotePath } from '../../domain/values/NotePath';
import { Timestamp } from '../../domain/values/Timestamp';
import { AIProviderPort, ChatMessageInput } from '../ports/AIProviderPort';
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
import { preprocessQueryTokens } from '../../domain/services/KoreanParticleStripper';
import { detectContentLanguage } from '../utils/detectContentLanguage';

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
    // 1. Classify intent + extract keywords in a single AI call
    const { intent, keywords } = await this.classifyIntent(request.question);

    let filteredChunks: ReadonlyArray<SearchResult> = [];
    const settings = await this.config.getSettings();
    let prompt: string;

    if (intent === 'vault' && keywords.length > 0) {
      // 2a. Vault query: search → privacy filter → redact → build prompt
      const contextChunks = await this.hybridSearch(
        keywords.join(' '),
        request.maxContextChunks,
      );

      const allowedChecks = await Promise.all(
        contextChunks.map(chunk => this.isChunkAllowed(chunk, [...settings.privacyRules]))
      );
      filteredChunks = contextChunks.filter((_, i) => allowedChecks[i]);

      const redactedChunks = filteredChunks.map(sr => ({
        ...sr,
        chunk: { ...sr.chunk, text: applyContentRedaction(sr.chunk.text as string, [...settings.privacyRules]) as typeof sr.chunk.text },
      }));
      prompt = this.buildPrompt(request.question, redactedChunks);
    } else {
      // 2b. General query: skip search, answer directly
      prompt = PromptTemplates.quickAskGeneral(request.question);
    }

    // 3. Call AI
    const aiResponse = await this.aiProvider.callCompletion({
      prompt,
      maxTokens: settings.aiMaxTokens,
      temperature: settings.aiTemperature,
    });

    // 4. Derive referenced note paths from context (deduplicated)
    const suggestedTags: ReadonlyArray<TagName> = [];
    const referencedNotes: ReadonlyArray<NotePath> = [...new Set(filteredChunks.map(sr => sr.notePath))];

    // 5. Save note
    const truncated = aiResponse.finishReason === 'length';
    const needsAllNotes = referencedNotes.length > 0 || aiResponse.content.includes('[[');
    const allNotes = needsAllNotes ? await this.vault.listNotes() : [];
    const content = this.formatAnswer(request.question, aiResponse.content, [...suggestedTags], referencedNotes, truncated, allNotes);
    const savedPath = await this.saveNote.execute({
      content,
      target: request.saveTarget,
      tags: suggestedTags,
      links: referencedNotes,
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
      referencedNotes,
      savedTo: savedPath,
      suggestedTags,
      suggestedLinks: referencedNotes,
      tokenUsage: aiResponse.tokenUsage,
      timestamp: now,
      truncated,
    };
  }

  async chat(
    question: string,
    session: ChatSession | null,
    maxContextChunks: number,
  ): Promise<{ reply: string; session: ChatSession; truncated: boolean }> {
    const settings = await this.config.getSettings();
    const now = this.clock.now();
    const lang = detectContentLanguage(question);

    const { intent, keywords } = await this.classifyIntent(question);

    let newChunks: ReadonlyArray<SearchResult> = [];
    if (intent === 'vault' && keywords.length > 0) {
      const rawChunks = await this.hybridSearch(keywords.join(' '), maxContextChunks);
      const allowedChecks = await Promise.all(
        rawChunks.map(chunk => this.isChunkAllowed(chunk, [...settings.privacyRules]))
      );
      const filtered = rawChunks.filter((_, i) => allowedChecks[i]);
      newChunks = filtered.map(sr => ({
        ...sr,
        chunk: { ...sr.chunk, text: applyContentRedaction(sr.chunk.text as string, [...settings.privacyRules]) as typeof sr.chunk.text },
      }));
    }

    const existingNotes = session?.referencedNotes ?? [];
    const newNotes = newChunks
      .map(sr => sr.notePath)
      .filter(p => !existingNotes.includes(p));
    const allReferencedNotes = [...new Set([...existingNotes, ...newNotes])];

    const existingChunks = session
      ? (session as ChatSession & { _contextChunks?: ReadonlyArray<NoteChunk> })._contextChunks ?? []
      : [];
    const mergedChunkTexts = new Set(existingChunks.map((c: NoteChunk) => c.text as string));
    const freshChunks = newChunks
      .map(sr => sr.chunk)
      .filter(c => !mergedChunkTexts.has(c.text as string));
    const allContextChunks = [...existingChunks, ...freshChunks]
      .slice(-QuickAskUseCase.MAX_CONTEXT_CHUNKS);

    if (allContextChunks.length === 0 && intent === 'vault') {
      const noResultMsg = PromptTemplates.quickAskNoResults(question);
      const newSession = this.createOrUpdateSession(session, question, noResultMsg, now, allReferencedNotes, allContextChunks, QuickAskUseCase.ZERO_USAGE);
      return { reply: noResultMsg, session: newSession, truncated: false };
    }

    const systemPrompt = allContextChunks.length > 0
      ? PromptTemplates.quickAskChatSystem(allContextChunks, lang)
      : PromptTemplates.quickAskGeneral(question);

    const messages = this.buildChatMessages(systemPrompt, session, question);
    const trimmedMessages = this.trimMessages(messages, QuickAskUseCase.MAX_MESSAGES);

    const aiResponse = await this.aiProvider.callCompletion({
      prompt: question,
      messages: trimmedMessages,
      maxTokens: settings.aiMaxTokens,
      temperature: settings.aiTemperature,
    });

    const allNotes = allReferencedNotes.length > 0 || aiResponse.content.includes('[[')
      ? await this.vault.listNotes()
      : [];
    const cleanedReply = this.cleanWikilinks(aiResponse.content, allNotes);

    const truncated = aiResponse.finishReason === 'length';
    const newSession = this.createOrUpdateSession(
      session, question, cleanedReply, now, allReferencedNotes, allContextChunks, aiResponse.tokenUsage,
    );
    return { reply: cleanedReply, session: newSession, truncated };
  }

  async saveConversation(session: ChatSession, saveTarget: SaveTarget): Promise<NotePath> {
    const turns = session.messages
      .reduce<Array<{ question: string; answer: string }>>((acc, msg) => {
        if (msg.role === 'user') {
          acc.push({ question: msg.content, answer: '' });
        } else if (msg.role === 'assistant' && acc.length > 0) {
          acc[acc.length - 1].answer = msg.content;
        }
        return acc;
      }, []);

    const turnBlocks = turns.map((t, i) =>
      `## Turn ${i + 1}\n\n### Question\n\n${t.question}\n\n### Answer\n\n${t.answer}`
    ).join('\n\n');

    const refLinks = session.referencedNotes.length > 0
      ? `\n\n## References\n\n${session.referencedNotes.map(n => `- [[${(n as string).replace(/\.md$/, '').split('/').pop()}]]`).join('\n')}`
      : '';

    const content = `${turnBlocks}${refLinks}`;

    const frontmatterTags = [createTagName('vaultend-qa')];
    const savedPath = await this.saveNote.execute({
      content,
      target: saveTarget,
      tags: frontmatterTags,
      links: session.referencedNotes,
    });

    const now = this.clock.now();
    await this.history.record({
      id: crypto.randomUUID(),
      action: 'quick-ask-save',
      notePath: savedPath,
      timestamp: now,
      description: `Quick Ask conversation (${turns.length} turns)`,
    });

    return savedPath;
  }

  private static readonly MAX_MESSAGES = 20;
  private static readonly MAX_CONTEXT_CHUNKS = 20;
  private static readonly ZERO_USAGE: TokenUsage = {
    promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0,
  };

  private createOrUpdateSession(
    session: ChatSession | null,
    question: string,
    reply: string,
    now: Timestamp,
    referencedNotes: NotePath[],
    contextChunks: ReadonlyArray<NoteChunk>,
    tokenUsage: TokenUsage,
  ): ChatSession {
    const userMsg: ChatMessage = { role: 'user', content: question, timestamp: now };
    const assistantMsg: ChatMessage = { role: 'assistant', content: reply, timestamp: now, tokenUsage };

    if (session) {
      const prev = session.totalTokenUsage;
      return {
        ...session,
        messages: [...session.messages, userMsg, assistantMsg],
        referencedNotes: [...referencedNotes],
        totalTokenUsage: {
          promptTokens: prev.promptTokens + tokenUsage.promptTokens,
          completionTokens: prev.completionTokens + tokenUsage.completionTokens,
          totalTokens: prev.totalTokens + tokenUsage.totalTokens,
          estimatedCostUsd: prev.estimatedCostUsd + tokenUsage.estimatedCostUsd,
        },
        _contextChunks: contextChunks,
      } as ChatSession;
    }

    return {
      id: crypto.randomUUID(),
      messages: [userMsg, assistantMsg],
      referencedNotes: [...referencedNotes],
      totalTokenUsage: tokenUsage,
      createdAt: now,
      systemPrompt: '',
      _contextChunks: contextChunks,
    } as ChatSession;
  }

  private buildChatMessages(
    systemPrompt: string,
    session: ChatSession | null,
    newQuestion: string,
  ): ChatMessageInput[] {
    const messages: ChatMessageInput[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (session) {
      for (const msg of session.messages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: newQuestion });
    return messages;
  }

  private trimMessages(messages: ChatMessageInput[], maxCount: number): ChatMessageInput[] {
    if (messages.length <= maxCount + 1) return messages;

    const system = messages[0];
    const rest = messages.slice(1);

    let toKeep = rest.slice(rest.length - maxCount);
    if (toKeep.length > 0 && toKeep[0].role === 'assistant') {
      toKeep = toKeep.slice(1);
    }
    return [system, ...toKeep];
  }

  private cleanWikilinks(content: string, allNotes: ReadonlyArray<NotePath>): string {
    let cleaned = content.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');

    const noteBasenames = new Set(
      allNotes.map(n => (n as string).split('/').pop()?.replace(/\.md$/, '') ?? ''),
    );
    cleaned = cleaned.replace(/\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]/g, (_match, target: string, alias?: string) => {
      const withoutFragment = target.trim().split('#')[0];
      const basename = withoutFragment.split('/').pop()?.replace(/\.md$/, '') ?? '';
      if (noteBasenames.has(basename)) return _match;
      return alias ?? target.trim();
    });

    return cleaned;
  }

  private async hybridSearch(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>> {
    const FETCH_SIZE = 20;
    const settings = await this.config.getSettings();
    const saveFolder = settings.defaultSaveFolder;
    const isQaNote = (path: string) => saveFolder.length > 0 && (path === saveFolder || path.startsWith(saveFolder + '/'));

    const allBm25 = await this.searchIndex.search(query, FETCH_SIZE);
    const bm25Results = allBm25.filter(r => !isQaNote(r.notePath as string));

    if (!this.embedding?.isReady() || !this.vectorStore) {
      return bm25Results.slice(0, maxResults);
    }

    try {
      const RRF_K = settings.rrfK;
      const embWeight = settings.rrfEmbeddingWeight;

      const queryVector = await this.embedding.embed(query);
      const allVectorResults = await this.vectorStore.search(queryVector, FETCH_SIZE);
      const vectorResults = allVectorResults.filter(vr => !isQaNote(vr.notePath as string));

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

  private async classifyIntent(userQuery: string): Promise<{ intent: 'vault' | 'general'; keywords: string[] }> {
    try {
      const prompt = PromptTemplates.classifyAndExtractKeywords(userQuery);
      const response = await this.aiProvider.callCompletion({
        prompt,
        maxTokens: 100,
        temperature: 0,
        jsonMode: true,
      });

      const parsed: unknown = JSON.parse(response.content);

      let intent: 'vault' | 'general';
      let rawKeywords: unknown[];

      if (Array.isArray(parsed)) {
        intent = 'vault';
        rawKeywords = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        intent = obj.intent === 'general' ? 'general' : 'vault';
        rawKeywords = Array.isArray(obj.keywords) ? obj.keywords : [];
      } else {
        intent = 'vault';
        rawKeywords = [];
      }

      const keywords = rawKeywords
        .filter((k): k is string => typeof k === 'string')
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .slice(0, 5);

      if (intent === 'general') {
        return { intent, keywords: [] };
      }

      if (keywords.length === 0) {
        const tokens = preprocessQueryTokens(userQuery);
        return { intent: 'vault', keywords: tokens };
      }

      return { intent, keywords };
    } catch {
      const tokens = preprocessQueryTokens(userQuery);
      return { intent: 'vault', keywords: tokens };
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

  private formatAnswer(
    question: string,
    answer: string,
    tags: ReadonlyArray<TagName>,
    links: ReadonlyArray<NotePath>,
    truncated: boolean,
    allNotes: ReadonlyArray<NotePath>,
  ): string {
    // Strip markdown URL links from AI response to prevent broken links in vault
    let cleanedAnswer = answer.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');

    // Strip wikilinks that don't exist in vault (AI hallucinated/modified names)
    const noteBasenames = new Set(
      allNotes.map(n => (n as string).split('/').pop()?.replace(/\.md$/, '') ?? ''),
    );
    cleanedAnswer = cleanedAnswer.replace(/\[\[([^\]\r\n|]+)(?:\|([^\]\r\n]+))?\]\]/g, (_match, target: string, alias?: string) => {
      const withoutFragment = target.trim().split('#')[0];
      const basename = withoutFragment.split('/').pop()?.replace(/\.md$/, '') ?? '';
      if (noteBasenames.has(basename)) {
        return _match;
      }
      return alias ?? target.trim();
    });
    let result = `## Question\n\n${question}\n\n## Answer\n\n${cleanedAnswer}`;

    if (truncated) {
      result += '\n\n> [!warning] Response truncated due to token limit.';
    }

    if (tags.length > 0) {
      result += `\n\n**Tags:** ${tags.join(' ')}`;
    }

    if (links.length > 0) {
      const linkLines = links.map(lp => this.resolveWikilink(lp, allNotes));
      result += `\n\n## References\n\n${linkLines.join('\n')}`;
    }

    return result;
  }

  private resolveWikilink(linkPath: NotePath, allNotes: ReadonlyArray<NotePath>): string {
    const pathStr = linkPath as string;
    const basename = pathStr.split('/').pop()?.replace(/\.md$/, '') ?? pathStr;

    const duplicates = allNotes.filter(n => {
      const other = (n as string).split('/').pop()?.replace(/\.md$/, '');
      return other === basename;
    });

    if (duplicates.length <= 1) {
      return `- [[${basename}]]`;
    }

    const parts = pathStr.replace(/\.md$/, '').split('/');
    if (parts.length <= 1) {
      return `- [[${basename}]]`;
    }

    const parentSlug = `${parts[parts.length - 2]}/${basename}`;
    const stillAmbiguous = duplicates.filter(n => {
      const rel = (n as string).replace(/\.md$/, '');
      return rel.endsWith(parentSlug);
    });

    if (stillAmbiguous.length > 1) {
      return `- [[${pathStr.replace(/\.md$/, '')}]]`;
    }

    return `- [[${parentSlug}]]`;
  }
}
