import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObsidianVaultAdapter } from '../ObsidianVaultAdapter';
import { NoteNotFoundError } from '../../../domain/errors/DomainErrors';
import type { NotePath } from '../../../domain/values/NotePath';
import { TFile } from 'obsidian';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function createMockApp(overrides?: Record<string, any>) {
  const files: TFile[] = [];

  return {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => {
        return files.find(f => f.path === path) ?? null;
      }),
      read: vi.fn().mockResolvedValue('# Title\n\nContent'),
      modify: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue(undefined),
      getMarkdownFiles: vi.fn(() => files),
      on: vi.fn().mockReturnValue({ id: 'ref' }),
      offref: vi.fn(),
    },
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(null),
      getFirstLinkpathDest: vi.fn().mockReturnValue(null),
      resolvedLinks: {},
    },
    fileManager: {
      processFrontMatter: vi.fn(async (_file: any, cb: (fm: any) => void) => {
        const fm: Record<string, unknown> = {};
        cb(fm);
      }),
    },
    _files: files,
    ...overrides,
  } as any;
}

function addFile(app: any, path: string): TFile {
  const file = new TFile(path);
  app._files.push(file);
  app.vault.getAbstractFileByPath.mockImplementation((p: string) => {
    return app._files.find((f: any) => f.path === p) ?? null;
  });
  return file;
}

describe('ObsidianVaultAdapter', () => {
  let app: ReturnType<typeof createMockApp>;
  let adapter: ObsidianVaultAdapter;

  beforeEach(() => {
    app = createMockApp();
    adapter = new ObsidianVaultAdapter(app);
  });

  describe('readNote', () => {
    it('존재하는 파일을 Note 모델로 반환한다', async () => {
      const file = addFile(app, 'folder/note.md');
      app.vault.read.mockResolvedValue('# Hello\n\nWorld');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['test'] },
        tags: [{ tag: '#inline' }],
        links: [],
      });

      const result = await adapter.readNote(np('folder/note.md'));

      expect(result).not.toBeNull();
      expect(result!.path as string).toBe('folder/note.md');
      expect(result!.title as string).toBe('note');
      expect(result!.content).toBe('# Hello\n\nWorld');
    });

    it('파일이 없으면 null을 반환한다', async () => {
      const result = await adapter.readNote(np('nonexistent.md'));
      expect(result).toBeNull();
    });

    it('프론트매터 태그를 파싱한다', async () => {
      addFile(app, 'note.md');
      app.vault.read.mockResolvedValue('content');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['typescript', '#react'] },
        tags: [],
        links: [],
      });

      const result = await adapter.readNote(np('note.md'));
      const tagStrings = result!.metadata.tags.map(t => t as string);
      expect(tagStrings).toContain('#typescript');
      expect(tagStrings).toContain('#react');
    });

    it('인라인 태그를 파싱한다', async () => {
      addFile(app, 'note.md');
      app.vault.read.mockResolvedValue('content');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {},
        tags: [{ tag: '#inline-tag' }],
        links: [],
      });

      const result = await adapter.readNote(np('note.md'));
      const tagStrings = result!.metadata.tags.map(t => t as string);
      expect(tagStrings).toContain('#inline-tag');
    });

    it('중복 태그를 제거한다', async () => {
      addFile(app, 'note.md');
      app.vault.read.mockResolvedValue('content');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { tags: ['dupe'] },
        tags: [{ tag: '#dupe' }],
        links: [],
      });

      const result = await adapter.readNote(np('note.md'));
      const tagStrings = result!.metadata.tags.map(t => t as string);
      const dupeCount = tagStrings.filter(t => t === '#dupe').length;
      expect(dupeCount).toBe(1);
    });

    it('링크를 resolve하여 파싱한다', async () => {
      const file = addFile(app, 'note.md');
      app.vault.read.mockResolvedValue('content');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {},
        links: [{ link: 'Other' }],
      });
      app.metadataCache.getFirstLinkpathDest.mockReturnValue(new TFile('other.md'));

      const result = await adapter.readNote(np('note.md'));
      expect(result!.metadata.links.map(l => l as string)).toContain('other.md');
    });

    it('백링크를 파싱한다', async () => {
      addFile(app, 'target.md');
      app.vault.read.mockResolvedValue('content');
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });
      app.metadataCache.resolvedLinks = {
        'source.md': { 'target.md': 1 },
      };

      const result = await adapter.readNote(np('target.md'));
      expect(result!.metadata.backlinks.map(b => b as string)).toContain('source.md');
    });

    it('콘텐츠를 청크로 분할한다', async () => {
      addFile(app, 'note.md');
      app.vault.read.mockResolvedValue('# Section 1\n\nParagraph 1\n\n# Section 2\n\nParagraph 2');
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const result = await adapter.readNote(np('note.md'));
      expect(result!.chunks.length).toBe(2);
      expect(result!.chunks[0].headingPath as string).toBe('Section 1');
      expect(result!.chunks[1].headingPath as string).toBe('Section 2');
    });

    it('헤딩 없는 콘텐츠는 (root) 청크로 처리한다', async () => {
      addFile(app, 'note.md');
      app.vault.read.mockResolvedValue('Just plain text without headings.');
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const result = await adapter.readNote(np('note.md'));
      expect(result!.chunks[0].headingPath as string).toBe('(root)');
    });
  });

  describe('writeNote', () => {
    it('기존 파일이면 modify를 호출한다', async () => {
      addFile(app, 'existing.md');
      await adapter.writeNote(np('existing.md'), 'new content');
      expect(app.vault.modify).toHaveBeenCalled();
    });

    it('파일이 없으면 create를 호출한다', async () => {
      await adapter.writeNote(np('new-folder/new.md'), 'content');
      expect(app.vault.createFolder).toHaveBeenCalledWith('new-folder');
      expect(app.vault.create).toHaveBeenCalledWith('new-folder/new.md', 'content');
    });

    it('루트 경로 파일은 폴더 생성을 건너뛴다', async () => {
      await adapter.writeNote(np('root.md'), 'content');
      expect(app.vault.createFolder).not.toHaveBeenCalled();
      expect(app.vault.create).toHaveBeenCalledWith('root.md', 'content');
    });
  });

  describe('deleteNote', () => {
    it('존재하는 파일을 삭제한다', async () => {
      const file = addFile(app, 'delete-me.md');
      await adapter.deleteNote(np('delete-me.md'));
      expect(app.vault.delete).toHaveBeenCalledWith(file);
    });

    it('존재하지 않는 파일이면 아무것도 하지 않는다', async () => {
      await adapter.deleteNote(np('ghost.md'));
      expect(app.vault.delete).not.toHaveBeenCalled();
    });
  });

  describe('listNotes', () => {
    it('모든 마크다운 파일을 반환한다', async () => {
      addFile(app, 'a.md');
      addFile(app, 'folder/b.md');

      const result = await adapter.listNotes();
      expect(result).toHaveLength(2);
    });

    it('폴더 필터를 적용한다', async () => {
      addFile(app, 'inbox/a.md');
      addFile(app, 'inbox/b.md');
      addFile(app, 'other/c.md');

      const result = await adapter.listNotes('inbox');
      expect(result).toHaveLength(2);
    });
  });

  describe('updateFrontmatter', () => {
    it('processFrontMatter를 호출한다', async () => {
      addFile(app, 'note.md');
      await adapter.updateFrontmatter(np('note.md'), { tags: ['#new'] });
      expect(app.fileManager.processFrontMatter).toHaveBeenCalled();
    });

    it('파일이 없으면 NoteNotFoundError를 던진다', async () => {
      await expect(
        adapter.updateFrontmatter(np('ghost.md'), { tags: [] }),
      ).rejects.toThrow(NoteNotFoundError);
    });
  });

  describe('exists', () => {
    it('파일이 있으면 true', async () => {
      addFile(app, 'exists.md');
      const result = await adapter.exists(np('exists.md'));
      expect(result).toBe(true);
    });

    it('파일이 없으면 false', async () => {
      const result = await adapter.exists(np('nope.md'));
      expect(result).toBe(false);
    });
  });

  describe('watchEvents', () => {
    it('4가지 이벤트를 등록하고 해제 함수를 반환한다', () => {
      const handler = vi.fn();
      const unsubscribe = adapter.watchEvents(handler);

      expect(app.vault.on).toHaveBeenCalledWith('create', expect.any(Function));
      expect(app.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
      expect(app.vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
      expect(app.vault.on).toHaveBeenCalledWith('rename', expect.any(Function));

      unsubscribe();
      expect(app.vault.offref).toHaveBeenCalledTimes(4);
    });
  });
});
