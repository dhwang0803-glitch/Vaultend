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

  describe('extractLinkSuggestions (via execute)', () => {
    it('AI 응답에서 [[wikilink]]를 추출한다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '참고: [[TypeScript]] 기초와 [[React Hooks]]를 보세요.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault();

      const uc = createUseCase({ ai, vault });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      const linkStrings = result.suggestedLinks.map(l => l as string);
      expect(linkStrings).toContain('TypeScript');
      expect(linkStrings).toContain('React Hooks');
    });

    it('[[link|alias]] 형식에서 링크 대상만 추출한다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '[[Note Name|표시 텍스트]]를 참조',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });

      const uc = createUseCase({ ai });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      expect(result.suggestedLinks.map(l => l as string)).toContain('Note Name');
      expect(result.suggestedLinks.map(l => l as string)).not.toContain('표시 텍스트');
    });

    it('중복 링크를 제거한다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '[[Same]] and [[Same]] again',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });

      const uc = createUseCase({ ai });
      const result = await uc.execute({
        question: 'test',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      expect(result.suggestedLinks).toHaveLength(1);
    });

    it('autoLink=false면 링크를 추출하지 않는다', async () => {
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: '[[SomeLink]] in response',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });

      const uc = createUseCase({ ai });
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

  describe('auto-link fallback (#64)', () => {
    it('AI가 링크를 제안하지 않으면 참조 노트를 링크로 사용한다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('notes/hooks.md', 'React hooks guide'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: 'No wikilinks in this response.',
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCostUsd: 0.001 },
          finishReason: 'stop' as const,
        }),
      });
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ metadata: createTestMetadata() })),
      });

      const uc = createUseCase({ vault, search, ai });
      const result = await uc.execute({
        question: 'React hooks?',
        maxContextChunks: 5,
        saveTarget: { kind: 'new-note', title: 'Q' as unknown as NoteTitle },
        autoTag: false,
        autoLink: true,
      });

      expect(result.suggestedLinks.map(l => l as string)).toContain('notes/hooks.md');
    });

    it('autoLink=false면 참조 노트가 있어도 링크를 추가하지 않는다', async () => {
      const searchResults: SearchResult[] = [
        makeSearchResult('notes/hooks.md', 'React hooks guide'),
      ];
      const search = createMockSearch(searchResults);
      const ai = createMockAI({
        callCompletion: vi.fn().mockResolvedValue({
          content: 'No wikilinks here.',
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
        autoLink: false,
      });

      expect(result.suggestedLinks).toHaveLength(0);
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
  });
});
