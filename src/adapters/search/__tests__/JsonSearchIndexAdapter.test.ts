import { describe, it, expect, vi } from 'vitest';
import { JsonSearchIndexAdapter } from '../JsonSearchIndexAdapter';
import { createMockVault } from '../../../test-utils/mock-ports';
import { createTestNote } from '../../../test-utils/fixtures';
import type { NotePath } from '../../../domain/values/NotePath';
import type { NoteChunk } from '../../../domain/models/NoteChunk';
import type { ChunkText } from '../../../domain/values/ChunkText';
import type { HeadingPath } from '../../../domain/values/HeadingPath';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function makeChunk(text: string, heading = 'Section'): NoteChunk {
  return {
    headingPath: heading as unknown as HeadingPath,
    text: text as unknown as ChunkText,
    startLine: 0,
    endLine: 5,
  };
}

describe('JsonSearchIndexAdapter', () => {
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

    it('1글자 검색어는 무시한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('a b c data')]);
      const results = await adapter.search('a b', 10);

      expect(results).toHaveLength(0);
    });

    it('여러 텀이 모두 매칭되면 점수가 높다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('partial.md'), [makeChunk('only typescript')]);
      await adapter.index(np('full.md'), [makeChunk('typescript react hooks')]);

      const results = await adapter.search('typescript react', 10);
      expect(results[0].notePath).toBe(np('full.md'));
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
        readNote: vi.fn().mockResolvedValue(null),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      await adapter.index(np('note.md'), [makeChunk('content')]);

      expect(vault.writeNote).toHaveBeenCalledWith(
        np('.knowledge-maintenance/search-index.json'),
        expect.any(String),
      );
    });

    it('기존 인덱스 파일이 있으면 로드한다', async () => {
      const indexData = {
        'old-note.md': [{
          notePath: 'old-note.md',
          headingPath: 'Title',
          text: 'existing indexed text',
          originalText: 'Existing indexed text',
          startLine: 0,
          endLine: 3,
        }],
      };
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: JSON.stringify(indexData) }),
        ),
      });
      const adapter = new JsonSearchIndexAdapter(vault);

      const results = await adapter.search('existing', 10);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
