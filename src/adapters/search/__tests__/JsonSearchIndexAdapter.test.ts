import { describe, it, expect, vi } from 'vitest';
import { JsonSearchIndexAdapter } from '../JsonSearchIndexAdapter';
import { createMockVault } from '../../../test-utils/mock-ports';
import type { NotePath } from '../../../domain/values/NotePath';
import type { NoteChunk } from '../../../domain/models/NoteChunk';
import type { ChunkText } from '../../../domain/values/ChunkText';
import type { HeadingPath } from '../../../domain/values/HeadingPath';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function makeChunk(text: string, heading = 'Section', startLine = 0): NoteChunk {
  return {
    headingPath: heading as unknown as HeadingPath,
    text: text as unknown as ChunkText,
    startLine,
    endLine: startLine + 5,
  };
}

describe('JsonSearchIndexAdapter (MiniSearch)', () => {
  describe('index + search', () => {
    it('인덱스한 청크를 검색으로 찾을 수 있다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('TypeScript is great')]);
      const results = await adapter.search('typescript', 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].notePath).toBe(np('note.md'));
    });

    it('대소문자를 무시하여 검색한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('React Hooks Pattern')]);
      const results = await adapter.search('react hooks', 10);

      expect(results.length).toBeGreaterThan(0);
    });

    it('maxResults를 초과하지 않는다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('a.md'), [makeChunk('keyword content')]);
      await adapter.index(np('b.md'), [makeChunk('keyword stuff')]);
      await adapter.index(np('c.md'), [makeChunk('keyword data')]);

      const results = await adapter.search('keyword', 2);
      expect(results).toHaveLength(2);
    });

    it('매칭되지 않는 검색어는 빈 결과를 반환한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('Hello World')]);
      const results = await adapter.search('nonexistent', 10);

      expect(results).toHaveLength(0);
    });

    it('빈 검색어는 빈 결과를 반환한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('some data')]);
      const results = await adapter.search('', 10);

      expect(results).toHaveLength(0);
    });

    it('여러 텀이 모두 매칭되면 점수가 높다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('partial.md'), [makeChunk('only typescript guide')]);
      await adapter.index(np('full.md'), [makeChunk('typescript react hooks pattern')]);

      const results = await adapter.search('typescript react', 10);
      expect(results[0].notePath).toBe(np('full.md'));
    });

    it('prefix 검색이 동작한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('programming with typescript')]);
      const results = await adapter.search('program', 10);

      expect(results.length).toBeGreaterThan(0);
    });

    it('term frequency가 높은 문서가 상위 랭킹된다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('low.md'), [makeChunk('react is a library')]);
      await adapter.index(np('high.md'), [makeChunk('react react react components in react')]);

      const results = await adapter.search('react', 10);
      expect(results[0].notePath).toBe(np('high.md'));
    });
  });

  describe('re-indexing', () => {
    it('같은 노트를 다시 인덱스하면 이전 항목을 교체한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('old content about python')]);
      await adapter.index(np('note.md'), [makeChunk('new content about rust')]);

      const oldResults = await adapter.search('python', 10);
      const newResults = await adapter.search('rust', 10);

      expect(oldResults).toHaveLength(0);
      expect(newResults.length).toBeGreaterThan(0);
    });
  });

  describe('remove', () => {
    it('인덱스에서 특정 노트를 제거한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('searchable content')]);
      await adapter.remove(np('note.md'));
      const results = await adapter.search('searchable', 10);

      expect(results).toHaveLength(0);
    });
  });

  describe('rebuild', () => {
    it('인덱스 캐시를 초기화한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('data here')]);
      await adapter.rebuild();
      const results = await adapter.search('data', 10);

      expect(results).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('index 시 JSON 파일로 flush한다', async () => {
      const vault = createMockVault({
        readFileRaw: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('content')]);

      expect(vault.writeFileRaw).toHaveBeenCalledWith(
        '.vaultend/search-index.json',
        expect.any(String),
      );
    });

    it('저장된 인덱스를 로드하여 검색할 수 있다', async () => {
      const vault1 = createMockVault({
        readFileRaw: vi.fn().mockResolvedValue(null),
      });
      const adapter1 = new JsonSearchIndexAdapter(vault1);
      await adapter1.index(np('note.md'), [makeChunk('persisted content about databases')]);

      const savedData = (vault1.writeFileRaw as ReturnType<typeof vi.fn>).mock.calls[0][1];

      const vault2 = createMockVault({
        readFileRaw: vi.fn().mockResolvedValue(savedData),
      });
      const adapter2 = new JsonSearchIndexAdapter(vault2);
      const results = await adapter2.search('databases', 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].notePath).toBe(np('note.md'));
    });
  });
});
