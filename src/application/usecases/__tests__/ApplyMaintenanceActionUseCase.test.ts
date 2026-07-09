import { describe, it, expect, vi } from 'vitest';
import { ApplyMaintenanceActionUseCase } from '../ApplyMaintenanceActionUseCase';
import { createMockVault, createMockHistory, createMockClock } from '../../../test-utils/mock-ports';
import { createTestNote, createTestMetadata } from '../../../test-utils/fixtures';
import type { NotePath } from '../../../domain/values/NotePath';
import type { TagName } from '../../../domain/values/TagName';
import type { MaintenanceAction } from '../../../domain/models/MaintenanceAction';
import type { VaultAccessPort } from '../../ports/VaultAccessPort';
import type { HistoryPort } from '../../ports/HistoryPort';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function tn(tag: string): TagName {
  return tag as unknown as TagName;
}

describe('ApplyMaintenanceActionUseCase', () => {
  function createUseCase(
    vaultOverrides?: Partial<VaultAccessPort>,
    historyOverrides?: Partial<HistoryPort>,
  ) {
    const vault = createMockVault(vaultOverrides);
    const history = { ...createMockHistory(), ...historyOverrides };
    const clock = createMockClock();
    const uc = new ApplyMaintenanceActionUseCase(vault, history, clock);
    return { uc, vault, history, clock };
  }

  describe('delete-orphan', () => {
    it('노트를 삭제하고 이력에 기록한다', async () => {
      const note = createTestNote({ path: np('orphan.md'), content: '# Orphan' });
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      const action: MaintenanceAction = { kind: 'delete-orphan', notePath: np('orphan.md') };
      await uc.execute(action);

      expect(vault.deleteNote).toHaveBeenCalledWith(np('orphan.md'));
      expect(history.record).toHaveBeenCalledTimes(1);

      const entry = (history.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.action).toBe('delete');
      expect(entry.previousContent).toBe('# Orphan');
      expect(entry.notePath).toBe(np('orphan.md'));
    });

    it('존재하지 않는 노트도 삭제를 시도하고 이력에 빈 previousContent를 기록한다', async () => {
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(null),
      });

      await uc.execute({ kind: 'delete-orphan', notePath: np('gone.md') });

      expect(vault.deleteNote).toHaveBeenCalledWith(np('gone.md'));
      const entry = (history.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.previousContent).toBe('');
    });
  });

  describe('remove-broken-link', () => {
    it('해당 라인의 wikilink를 plain text로 대체한다', async () => {
      const content = 'line1\nSee [[missing-note]] for details\nline3';
      const note = createTestNote({ path: np('source.md'), content });
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      const action: MaintenanceAction = {
        kind: 'remove-broken-link',
        sourcePath: np('source.md'),
        targetLink: 'missing-note',
        lineNumber: 2,
      };
      await uc.execute(action);

      expect(vault.writeNote).toHaveBeenCalledWith(
        np('source.md'),
        'line1\nSee missing-note for details\nline3',
      );
      const entry = (history.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.action).toBe('link-remove');
      expect(entry.previousContent).toBe(content);
    });

    it('별명(alias) 포함 wikilink도 처리한다', async () => {
      const content = 'Check [[missing|alias text]] here';
      const note = createTestNote({ path: np('source.md'), content });
      const { uc, vault } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      await uc.execute({
        kind: 'remove-broken-link',
        sourcePath: np('source.md'),
        targetLink: 'missing',
        lineNumber: 1,
      });

      expect(vault.writeNote).toHaveBeenCalledWith(
        np('source.md'),
        'Check missing here',
      );
    });

    it('소스 노트가 없으면 아무 것도 하지 않는다', async () => {
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(null),
      });

      await uc.execute({
        kind: 'remove-broken-link',
        sourcePath: np('gone.md'),
        targetLink: 'x',
        lineNumber: 1,
      });

      expect(vault.writeNote).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('잘못된 lineNumber면 아무 것도 하지 않는다', async () => {
      const note = createTestNote({ content: 'single line' });
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      await uc.execute({
        kind: 'remove-broken-link',
        sourcePath: np('a.md'),
        targetLink: 'x',
        lineNumber: 99,
      });

      expect(vault.writeNote).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });
  });

  describe('create-missing-note', () => {
    it('빈 노트를 생성하고 이력에 기록한다', async () => {
      const { uc, vault, history } = createUseCase();

      await uc.execute({ kind: 'create-missing-note', targetLink: 'new-topic' });

      expect(vault.writeNote).toHaveBeenCalledWith(np('new-topic.md'), '# new-topic\n');
      const entry = (history.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.action).toBe('create');
      expect(entry.description).toContain('new-topic');
    });

    it('.md가 이미 포함된 targetLink도 처리한다', async () => {
      const { uc, vault } = createUseCase();

      await uc.execute({ kind: 'create-missing-note', targetLink: 'note.md' });

      expect(vault.writeNote).toHaveBeenCalledWith(np('note.md'), '# note.md\n');
    });

    it('heading fragment(#section)를 제거하고 노트를 생성한다', async () => {
      const { uc, vault } = createUseCase();

      await uc.execute({ kind: 'create-missing-note', targetLink: 'missing#section' });

      expect(vault.writeNote).toHaveBeenCalledWith(np('missing.md'), '# missing\n');
    });

    it('fragment만 있는 링크(#only)는 무시한다', async () => {
      const { uc, vault } = createUseCase();

      await uc.execute({ kind: 'create-missing-note', targetLink: '#only-heading' });

      expect(vault.writeNote).not.toHaveBeenCalled();
    });
  });

  describe('apply-missing-tags', () => {
    it('누락된 태그를 frontmatter에 추가한다', async () => {
      const content = '---\ntags:\n  - existing\n---\n# Tagged\ncontent';
      const note = createTestNote({
        path: np('tagged.md'),
        content,
        metadata: createTestMetadata({ tags: [tn('#existing')] }),
      });
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      await uc.execute({
        kind: 'apply-missing-tags',
        notePath: np('tagged.md'),
        tags: [tn('#new-tag'), tn('#another')],
      });

      expect(vault.updateFrontmatter).toHaveBeenCalledWith(
        np('tagged.md'),
        { tags: ['#existing', '#new-tag', '#another'] },
      );
      const entry = (history.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.action).toBe('tag-add');
      expect(entry.previousContent).toBe(content);
    });

    it('인라인 태그는 frontmatter에 복사하지 않는다', async () => {
      const content = '# Note\nSome text with #inline-tag in body';
      const note = createTestNote({
        path: np('inline.md'),
        content,
        metadata: createTestMetadata({ tags: [tn('#inline-tag')] }),
      });
      const { uc, vault } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      await uc.execute({
        kind: 'apply-missing-tags',
        notePath: np('inline.md'),
        tags: [tn('#new-tag')],
      });

      expect(vault.updateFrontmatter).toHaveBeenCalledWith(
        np('inline.md'),
        { tags: ['#new-tag'] },
      );
    });

    it('이미 존재하는 태그는 추가하지 않는다', async () => {
      const note = createTestNote({
        metadata: createTestMetadata({ tags: [tn('#already')] }),
      });
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(note),
      });

      await uc.execute({
        kind: 'apply-missing-tags',
        notePath: np('x.md'),
        tags: [tn('#already')],
      });

      expect(vault.updateFrontmatter).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('노트가 없으면 아무 것도 하지 않는다', async () => {
      const { uc, vault, history } = createUseCase({
        readNote: vi.fn().mockResolvedValue(null),
      });

      await uc.execute({
        kind: 'apply-missing-tags',
        notePath: np('gone.md'),
        tags: [tn('#tag')],
      });

      expect(vault.updateFrontmatter).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('vault 변경 없이 이력만 기록한다', async () => {
      const { uc, vault, history } = createUseCase();

      await uc.execute({
        kind: 'dismiss',
        issueType: 'orphan',
        identifier: 'lonely-note',
      });

      expect(vault.writeNote).not.toHaveBeenCalled();
      expect(vault.deleteNote).not.toHaveBeenCalled();
      expect(vault.updateFrontmatter).not.toHaveBeenCalled();

      const entry = (history.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.action).toBe('dismiss');
      expect(entry.description).toContain('orphan');
      expect(entry.description).toContain('lonely-note');
    });
  });
});
