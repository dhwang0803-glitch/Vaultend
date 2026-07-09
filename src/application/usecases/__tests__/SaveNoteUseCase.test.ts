import { describe, it, expect, vi } from 'vitest';
import { SaveNoteUseCase } from '../SaveNoteUseCase';
import { createMockVault, createMockConfig, createMockClock } from '../../../test-utils/mock-ports';
import { createTestNote } from '../../../test-utils/fixtures';
import { NoteNotFoundError } from '../../../domain/errors/DomainErrors';
import type { NotePath } from '../../../domain/values/NotePath';
import type { NoteTitle } from '../../../domain/values/NoteTitle';
import type { HeadingPath } from '../../../domain/values/HeadingPath';
import type { TagName } from '../../../domain/values/TagName';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

describe('SaveNoteUseCase', () => {
  describe('execute — new-note', () => {
    it('새 노트를 생성한다', async () => {
      const vault = createMockVault();
      const config = createMockConfig({ defaultSaveFolder: 'Notes' });
      const uc = new SaveNoteUseCase(vault, config, createMockClock());

      const result = await uc.execute({
        content: 'Hello world',
        target: {
          kind: 'new-note',
          title: 'My Note' as unknown as NoteTitle,
        },
      });

      expect(result as string).toBe('Notes/My Note.md');
      expect(vault.writeNote).toHaveBeenCalledTimes(1);
      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('Hello world');
      expect(writtenContent).toContain('---');
    });

    it('지정 폴더에 생성한다', async () => {
      const vault = createMockVault();
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      const result = await uc.execute({
        content: 'content',
        target: {
          kind: 'new-note',
          title: 'Test' as unknown as NoteTitle,
          folder: np('Custom'),
        },
      });

      expect(result as string).toBe('Custom/Test.md');
    });

    it('태그가 있으면 frontmatter에 포함한다', async () => {
      const vault = createMockVault();
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      await uc.execute({
        content: 'content',
        target: { kind: 'new-note', title: 'Test' as unknown as NoteTitle },
        tags: ['#dev', '#react'] as unknown as ReadonlyArray<TagName>,
      });

      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('tags: [#dev, #react]');
    });
  });

  describe('execute — append-to-note', () => {
    it('기존 노트 끝에 내용을 추가한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: 'Existing content' })),
      });
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      await uc.execute({
        content: 'New content',
        target: {
          kind: 'append-to-note',
          targetPath: np('note.md'),
          position: 'bottom',
        },
      });

      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('Existing content');
      expect(writtenContent).toContain('New content');
    });

    it('노트가 없으면 NoteNotFoundError를 던진다', async () => {
      const vault = createMockVault({ readNote: vi.fn().mockResolvedValue(null) });
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      await expect(uc.execute({
        content: 'content',
        target: {
          kind: 'append-to-note',
          targetPath: np('missing.md'),
          position: 'bottom',
        },
      })).rejects.toThrow(NoteNotFoundError);
    });
  });

  describe('execute — daily-note', () => {
    it('Daily Note가 없으면 새로 생성한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      // 2024-07-03 12:26:40 UTC → YYYY-MM-DD
      const clock = createMockClock(1720008400000);
      const config = createMockConfig({ dailyNoteFormat: 'YYYY-MM-DD', dailyNoteFolder: 'Daily' });
      const uc = new SaveNoteUseCase(vault, config, clock);

      await uc.execute({
        content: 'Daily entry',
        target: { kind: 'daily-note', position: 'bottom' },
      });

      expect(vault.writeNote).toHaveBeenCalledTimes(1);
      const writtenPath = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(writtenPath).toContain('Daily/');
      expect(writtenPath).toContain('.md');
    });

    it('Daily Note가 있으면 내용을 추가한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(createTestNote({ content: '# 2024-07-03\n\nExisting' })),
      });
      const clock = createMockClock(1720008400000);
      const config = createMockConfig({ dailyNoteFormat: 'YYYY-MM-DD', dailyNoteFolder: 'Daily' });
      const uc = new SaveNoteUseCase(vault, config, clock);

      await uc.execute({
        content: 'New entry',
        target: { kind: 'daily-note', position: 'bottom' },
      });

      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('Existing');
      expect(writtenContent).toContain('New entry');
    });
  });

  describe('insertUnderHeading (via append-to-note)', () => {
    it('기존 헤딩 아래에 top 위치로 삽입한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: '# Title\n\n## Section\n\nExisting text\n\n## Other' }),
        ),
      });
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      await uc.execute({
        content: 'Inserted',
        target: {
          kind: 'append-to-note',
          targetPath: np('note.md'),
          headingPath: 'Section' as unknown as HeadingPath,
          position: 'top',
        },
      });

      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const lines = writtenContent.split('\n');
      const sectionIdx = lines.findIndex(l => l.includes('## Section'));
      expect(lines[sectionIdx + 2]).toBe('Inserted');
    });

    it('기존 헤딩 아래에 bottom 위치로 삽입한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: '# Title\n\n## Section\n\nExisting text\n\n## Other' }),
        ),
      });
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      await uc.execute({
        content: 'Appended',
        target: {
          kind: 'append-to-note',
          targetPath: np('note.md'),
          headingPath: 'Section' as unknown as HeadingPath,
          position: 'bottom',
        },
      });

      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('Appended');
      // Appended 뒤에 Other 섹션이 있어야 함
      expect(writtenContent.indexOf('Appended')).toBeLessThan(writtenContent.indexOf('## Other'));
    });

    it('없는 헤딩이면 새 섹션을 추가한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(
          createTestNote({ content: '# Title\n\nSome content' }),
        ),
      });
      const uc = new SaveNoteUseCase(vault, createMockConfig(), createMockClock());

      await uc.execute({
        content: 'New section content',
        target: {
          kind: 'append-to-note',
          targetPath: np('note.md'),
          headingPath: 'NewSection' as unknown as HeadingPath,
          position: 'top',
        },
      });

      const writtenContent = (vault.writeNote as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toContain('## NewSection');
      expect(writtenContent).toContain('New section content');
    });
  });

  describe('formatDate (via daily-note)', () => {
    it('YYYY-MM-DD 포맷으로 날짜를 생성한다', async () => {
      const vault = createMockVault({
        readNote: vi.fn().mockResolvedValue(null),
      });
      // 2024-07-15 UTC
      const clock = createMockClock(1721001600000);
      const config = createMockConfig({ dailyNoteFormat: 'YYYY-MM-DD', dailyNoteFolder: '' });
      const uc = new SaveNoteUseCase(vault, config, clock);

      const result = await uc.execute({
        content: 'test',
        target: { kind: 'daily-note', position: 'bottom' },
      });

      const path = result as string;
      // 날짜 패턴이 포함되어야 함 (로컬 타임존 의존)
      expect(path).toMatch(/\d{4}-\d{2}-\d{2}\.md$/);
    });
  });
});
