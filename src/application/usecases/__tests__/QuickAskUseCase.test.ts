import { describe, it, expect, vi } from 'vitest';
import { QuickAskUseCase } from '../QuickAskUseCase';
import { SaveNoteUseCase } from '../SaveNoteUseCase';
import { createMockVault, createMockAI, createMockSearch, createMockHistory, createMockConfig, createMockClock } from '../../../test-utils/mock-ports';
import { createTestNote, createTestMetadata } from '../../../test-utils/fixtures';
import type { NotePath } from '../../../domain/values/NotePath';
import type { NoteTitle } from '../../../domain/values/NoteTitle';
import type { SearchResult } from '../../ports/SearchIndexPort';
import type { EmbeddingPort } from '../../ports/EmbeddingPort';
import type { VectorStorePort, VectorSearchResult } from '../../ports/VectorStorePort';
import type { ChunkText } from '../../../domain/values/ChunkText';
import type { HeadingPath } from '../../../domain/values/HeadingPath';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function makeSearchResult(notePath: string, text: string): SearchResult {
  return {
    notePath: np(notePath),
    chunk: {
      headingPath: 'h' as unknown as HeadingPath,
      text: text as unknown as ChunkText,
      startLine: 0,
      endLine: 1,
    },
    score: 0.9,
  };
}

describe('QuickAskUseCase', () => {
  function createUseCase(overrides?: {
    vault?: ReturnType<typeof createMockVault>;
    ai?: ReturnType<typeof createMockAI>;
    search?: ReturnType<typeof createMockSearch>;
    config?: ReturnType<typeof createMockConfig>;
  }) {
    const vault = overrides?.vault ?? createMockVault();
    const config = overrides?.config ?? createMockConfig();
    const clock = createMockClock();
    const saveNote = new SaveNoteUseCase(vault, config, clock);

    return new QuickAskUseCase(
      overrides?.ai ?? createMockAI(),
      vault,
      overrides?.search ?? createMockSearch(),
      createMockHistory(),
      config,
      clock,
      saveNote,
    );
  }

  describe('referencedNotes (컨텍스트 출처 기반 References)', () => {
    it('컨텍스트로 사용된 노트를 suggestedLinks에 포함한다', async () => {
      const search = createMockSearch([
        makeSearchResult('notes/TypeScript.md', 'TS content'),
        makeSearchResult('notes/React.md', 'React content'),
      ]);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
        listNotes: vi.fn().mockResolvedValue([np('notes/TypeScript.md'), np('notes/React.md')]),
      });

      const uc = createUseCase({ search, vault });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const linkStrings = result.suggestedLinks.map(l => l as string);
      expect(linkStrings).toContain('notes/TypeScript.md');
      expect(linkStrings).toContain('notes/React.md');
    });

    it('중복 컨텍스트 노트를 deduplicate한다', async () => {
      const search = createMockSearch([
        makeSearchResult('notes/Same.md', 'chunk 1'),
        makeSearchResult('notes/Same.md', 'chunk 2'),
      ]);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
        listNotes: vi.fn().mockResolvedValue([np('notes/Same.md')]),
      });

      const uc = createUseCase({ search, vault });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      expect(result.suggestedLinks).toHaveLength(1);
    });

    it('컨텍스트가 없으면 suggestedLinks가 비어있다', async () => {
      const uc = createUseCase();
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      expect(result.suggestedLinks).toHaveLength(0);
    });
  });

  describe('isChunkAllowed (via execute)', () => {
    it('folder-exclude 규칙에 걸리는 청크를 필터링한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('private/secret.md', 'secret data'),
        makeSearchResult('public/open.md', 'open data'),
      ];
      const search = createMockSearch(searchResults);

      const vault = createMockVault({
        readNote: vi.fn().mockImplementation(async (path: NotePath) => {
          return createTestNote({ path, metadata: createTestMetadata() });
        }),
      });

      const config = createMockConfig({
        privacyRules: [{
          id: '1',
          name: 'private',
          type: 'folder-exclude',
          pattern: 'private/',
          enabled: true,
        }],
      });

      const uc = createUseCase({ vault, search, config });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 10,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      // Chunks from private/secret.md are filtered, only public/open.md used
      expect(result.contextChunksUsed).toHaveLength(1);
      expect((result.contextChunksUsed[0].text as string)).toBe('open data');
    });

    it('프라이버시 규칙이 없으면 모든 청크를 사용한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('a.md', 'chunk A'),
        makeSearchResult('b.md', 'chunk B'),
      ];
      const search = createMockSearch(searchResults);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ metadata: createTestMetadata() }),
        ),
      });

      const uc = createUseCase({ vault, search });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 10,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      expect(result.contextChunksUsed).toHaveLength(2);
    });
  });

  describe('content-redact (via execute)', () => {
    it('content-redact 규칙이 있으면 AI에 보내는 청크 텍스트에서 패턴이 마스킹된다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('note.md', 'my password:abc123 is here'),
      ];
      const search = createMockSearch(searchResults);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ metadata: createTestMetadata() }),
        ),
      });
      const ai = createMockAI();
      const config = createMockConfig({
        privacyRules: [{
          id: '1',
          name: 'redact-passwords',
          type: 'content-redact',
          pattern: 'password:\\S+',
          enabled: true,
        }],
      });

      const uc = createUseCase({ vault, search, ai, config });
      await uc.execute({
        question: 'test',
        maxContextChunks: 10,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      const calls = (ai.callCompletion as ReturnType<typeof vi.fn>).mock.calls;
      const answerCall = calls[calls.length - 1][0];
      expect(answerCall.prompt).toContain('[REDACTED]');
      expect(answerCall.prompt).not.toContain('password:abc123');
    });
  });

  describe('execute (전체 파이프라인)', () => {
    it('질문 → 검색 → AI → 저장 → 이력 전체 흐름을 실행한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });
      const search = createMockSearch([makeSearchResult('ctx.md', 'context')]);
      const history = createMockHistory();
      const config = createMockConfig();
      const clock = createMockClock();
      const saveNote = new SaveNoteUseCase(vault, config, clock);

      const uc = new QuickAskUseCase(
        createMockAI(),
        vault,
        search,
        history,
        config,
        clock,
        saveNote,
      );

      const result = await uc.execute({
        question: 'TypeScript란?',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q-TypeScript' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      expect(result.question).toBe('TypeScript란?');
      expect(result.answer).toBeTruthy();
      expect(result.savedTo).toBeTruthy();
      expect(result.tokenUsage).toBeDefined();
      expect(history.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('hybridSearch (embedding-only fallback)', () => {
    it('BM25에 없는 embedding-only 결과를 vault.readNote로 복원하여 포함한다', async () => {
      const embOnlyChunk = {
        headingPath: 'Embedding Section' as unknown as HeadingPath,
        text: 'embedding-only content' as unknown as ChunkText,
        startLine: 5,
        endLine: 10,
      };
      const noteWithChunks = createTestNote({
        path: np('semantic.md'),
        metadata: createTestMetadata(),
        chunks: [embOnlyChunk],
      });

      const vault = createMockVault({
        readNote: vi.fn().mockImplementation(async (p: NotePath) => {
          if ((p as string) === 'semantic.md') return noteWithChunks;
          return createTestNote({ path: p, metadata: createTestMetadata() });
        }),
      });

      // BM25 returns only one result (different note)
      const bm25Results: SearchResult[] = [makeSearchResult('keyword.md', 'keyword match')];
      const search = createMockSearch(bm25Results);

      // Embedding returns a result that is NOT in BM25
      const mockEmbedding: EmbeddingPort = {
        initialize: vi.fn().mockResolvedValue(true),
        isReady: vi.fn().mockReturnValue(true),
        embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
        embedBatch: vi.fn().mockResolvedValue([]),
        getDimension: vi.fn().mockReturnValue(3),
      };

      const vectorResult: VectorSearchResult = {
        notePath: np('semantic.md'),
        chunkIndex: 5,
        similarity: 0.95,
      };
      const mockVectorStore: VectorStorePort = {
        upsert: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([vectorResult]),
        flush: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      };

      const config = createMockConfig();
      const clock = createMockClock();
      const saveNote = new SaveNoteUseCase(vault, config, clock);

      const uc = new QuickAskUseCase(
        createMockAI(),
        vault,
        search,
        createMockHistory(),
        config,
        clock,
        saveNote,
        mockEmbedding,
        mockVectorStore,
      );

      const result = await uc.execute({
        question: 'semantic query',
        maxContextChunks: 10,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      // Both BM25 and embedding-only results should be included
      const texts = result.contextChunksUsed.map(c => c.text as string);
      expect(texts).toContain('keyword match');
      expect(texts).toContain('embedding-only content');
    });
  });

  describe('referencedNotes (#60)', () => {
    it('검색에서 사용된 노트 경로를 중복 없이 반환한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('notes/react.md', 'React hooks'),
        makeSearchResult('notes/react.md', 'React state'),
        makeSearchResult('notes/typescript.md', 'TS basics'),
      ];
      const search = createMockSearch(searchResults);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault, search });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      const refs = result.referencedNotes.map(n => n as string);
      expect(refs).toHaveLength(2);
      expect(refs).toContain('notes/react.md');
      expect(refs).toContain('notes/typescript.md');
    });
  });

  describe('truncated (#65)', () => {
    it('finishReason이 length면 truncated=true를 반환한다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: 'partial response...',
          tokenUsage: { promptTokens: 10, completionTokens: 4096, totalTokens: 4106, estimatedCostUsd: 0.01 },
          finishReason: 'length' as const,
        }),
      });

      const uc = createUseCase({ ai });
      const result = await uc.execute({
        question: 'long question',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      expect(result.truncated).toBe(true);
    });

    it('finishReason이 stop이면 truncated=false를 반환한다', async () => {
      const uc = createUseCase();
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      expect(result.truncated).toBe(false);
    });
  });

  describe('references unification', () => {
    it('suggestedLinks는 항상 referencedNotes와 동일하다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('notes/hooks.md', 'React hooks guide'),
      ];
      const search = createMockSearch(searchResults);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault, search });
      const result = await uc.execute({
        question: 'React hooks?',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      expect(result.suggestedLinks).toEqual(result.referencedNotes);
      expect(result.suggestedLinks.map(l => l as string)).toContain('notes/hooks.md');
    });

    it('autoLink 플래그와 무관하게 컨텍스트 노트가 suggestedLinks에 포함된다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('notes/hooks.md', 'React hooks guide'),
      ];
      const search = createMockSearch(searchResults);
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault, search });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      expect(result.suggestedLinks.map(l => l as string)).toContain('notes/hooks.md');
    });

    it('AI 응답의 [[wikilink]]가 suggestedLinks에 포함되지 않는다 (hallucination 방지)', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('notes/context.md', 'real context'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '답변입니다. [[Hallucinated Note]]와 [[존재하지않는노트]]를 참조하세요.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault, search, ai });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const links = result.suggestedLinks.map(l => l as string);
      expect(links).toEqual(['notes/context.md']);
      expect(links).not.toContain('Hallucinated Note');
      expect(links).not.toContain('존재하지않는노트');
    });

    it('autoTag=true면 저장 본문에 inline 태그가 포함된다', async () => {
      const ai = createMockAI({
        callClassification: vi.fn().mockResolvedValue({
          suggestedTags: ['#typescript', '#guide'],
          suggestedFolder: '',
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });
      const config = createMockConfig({ knownTags: ['#typescript', '#guide'] });

      const uc = createUseCase({ vault, ai, config });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: true,
        autoLink: false,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).toContain('**Tags:**');
      expect(savedContent).toContain('#typescript');
    });

    it('태그가 없으면 **Tags:** 라인이 출력되지 않는다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).not.toContain('**Tags:**');
    });
  });

  describe('buildSearchQuery (keyword extraction)', () => {
    const defaultRequest = {
      question: '윤기범에 대해서 알려줘',
      maxContextChunks: 5,
      saveTarget: { kind: 'new-note' as const, title: 'Q' as unknown as NoteTitle },
      autoTag: false,
      autoLink: false,
    };

    function createWithAI(completionResponses: Array<{ content: string }>) {
      let callIndex = 0;
      const ai = createMockAI({
        callCompletion: vi.fn().mockImplementation(() => {
          const resp = completionResponses[callIndex] ?? completionResponses[completionResponses.length - 1];
          callIndex++;
          return Promise.resolve({
            ...resp,
            tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0 },
            finishReason: 'stop' as const,
          });
        }),
      });
      const search = createMockSearch();
      const uc = createUseCase({ ai, search });
      return { ai, search, uc };
    }

    it('AI가 {"keywords": [...]} 객체를 반환하면 키워드를 검색어로 사용한다', async () => {
      const { search, uc } = createWithAI([
        { content: '{"keywords": ["윤기범"]}' },
        { content: 'AI answer' },
      ]);

      await uc.execute(defaultRequest);

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(searchCall[0]).toBe('윤기범');
    });

    it('AI가 배열을 반환하면 키워드를 검색어로 사용한다 (backward compat)', async () => {
      const { search, uc } = createWithAI([
        { content: '["Alice", "Bob"]' },
        { content: 'AI answer' },
      ]);

      await uc.execute({ ...defaultRequest, question: 'Tell me about Alice and Bob' });

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(searchCall[0]).toBe('Alice Bob');
    });

    it('키워드에 공백/빈 문자열이 있으면 필터링한다', async () => {
      const { search, uc } = createWithAI([
        { content: '{"keywords": ["  valid  ", "", "  ", "keyword"]}' },
        { content: 'AI answer' },
      ]);

      await uc.execute({ ...defaultRequest, question: 'test query' });

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(searchCall[0]).toBe('valid keyword');
    });

    it('키워드가 5개 초과면 상위 5개만 사용한다', async () => {
      const { search, uc } = createWithAI([
        { content: '{"keywords": ["a", "b", "c", "d", "e", "f", "g"]}' },
        { content: 'AI answer' },
      ]);

      await uc.execute({ ...defaultRequest, question: 'test' });

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      const words = (searchCall[0] as string).split(' ');
      expect(words).toHaveLength(5);
      expect(words).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('AI가 malformed JSON을 반환하면 particle strip fallback으로 동작한다', async () => {
      const { search, uc } = createWithAI([
        { content: 'not valid json' },
        { content: 'AI answer' },
      ]);

      await uc.execute(defaultRequest);

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      const query = searchCall[0] as string;
      expect(query).toContain('윤기범');
    });

    it('AI가 빈 배열을 반환하면 particle strip fallback으로 동작한다', async () => {
      const { search, uc } = createWithAI([
        { content: '{"keywords": []}' },
        { content: 'AI answer' },
      ]);

      await uc.execute(defaultRequest);

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      const query = searchCall[0] as string;
      expect(query).toContain('윤기범');
    });

    it('AI 호출이 실패하면 particle strip fallback으로 동작한다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn()
          .mockRejectedValueOnce(new Error('API error'))
          .mockResolvedValue({
            content: 'AI answer',
            tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0 },
            finishReason: 'stop' as const,
          }),
      });
      const search = createMockSearch();
      const uc = createUseCase({ ai, search });

      await uc.execute(defaultRequest);

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      const query = searchCall[0] as string;
      expect(query).toContain('윤기범');
    });

    it('AI가 숫자 배열을 반환하면 fallback으로 동작한다', async () => {
      const { search, uc } = createWithAI([
        { content: '{"keywords": [1, 2, 3]}' },
        { content: 'AI answer' },
      ]);

      await uc.execute(defaultRequest);

      const searchCall = (search.search as ReturnType<typeof vi.fn>).mock.calls[0];
      const query = searchCall[0] as string;
      expect(query).toContain('윤기범');
    });
  });

  describe('formatAnswer (#64 wikilink)', () => {
    it('저장된 노트에 basename-only wikilink로 References를 포함한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('folder/deep/note.md', 'content'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: 'Answer text.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault, search, ai });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).toContain('## References');
      expect(savedContent).toContain('[[note]]');
      expect(savedContent).not.toContain('folder/deep/');
    });

    it('동일 basename이 vault에 여러 개이면 상위 폴더를 접두사로 붙인다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('projects/hooks.md', 'React hooks'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: 'Answer.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
        listNotes: vi.fn().mockResolvedValue([
          np('projects/hooks.md'),
          np('archive/hooks.md'),
        ]),
      });

      const uc = createUseCase({ vault, search, ai });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).toContain('[[projects/hooks]]');
    });

    it('상위 폴더도 동일하면 전체 경로를 사용한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('a/notes/hooks.md', 'content'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: 'Answer.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
        listNotes: vi.fn().mockResolvedValue([
          np('a/notes/hooks.md'),
          np('b/notes/hooks.md'),
        ]),
      });

      const uc = createUseCase({ vault, search, ai });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).toContain('[[a/notes/hooks]]');
    });

    it('AI 응답 본문의 vault에 없는 wikilink는 brackets를 제거한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('wiki/이도진.md', 'character info'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '[[이도진]]은 중요한 인물이며, [[도진]]에게 정보를 공유합니다. [[윤기범]]도 관련됩니다.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
        listNotes: vi.fn().mockResolvedValue([
          np('wiki/이도진.md'),
          np('wiki/윤기범.md'),
        ]),
      });

      const uc = createUseCase({ vault, search, ai });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).toContain('[[이도진]]');
      expect(savedContent).toContain('[[윤기범]]');
      expect(savedContent).not.toContain('[[도진]]');
      expect(savedContent).toContain('도진에게');
    });

    it('[[link|alias]] 형식의 vault에 없는 wikilink는 alias 텍스트만 남긴다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '[[존재하는노트|표시텍스트]]와 [[없는노트|다른텍스트]]를 참조',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
        listNotes: vi.fn().mockResolvedValue([np('존재하는노트.md')]),
      });

      const uc = createUseCase({ vault, ai });
      await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: false,
      });

      const writeCall = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0];
      const savedContent = writeCall[1] as string;
      expect(savedContent).toContain('[[존재하는노트|표시텍스트]]');
      expect(savedContent).not.toContain('[[없는노트');
      expect(savedContent).toContain('다른텍스트');
    });
  });
});
