import { describe, it, expect, vi } from 'vitest';
import { FileHistoryAdapter } from '../FileHistoryAdapter';
import { createMockVault, createMockClock } from '../../../test-utils/mock-ports';
import type { HistoryEntry } from '../../../domain/models/HistoryEntry';
import type { NotePath } from '../../../domain/values/NotePath';
import type { Timestamp } from '../../../domain/values/Timestamp';
import { HistoryEntryNotFoundError } from '../../../domain/errors/DomainErrors';

function np(path: string): NotePath {
  return path as unknown as NotePath;
}

function ts(value: number): Timestamp {
  return value as unknown as Timestamp;
}

function makeEntry(overrides?: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 'entry-1',
    action: 'classify',
    notePath: np('test.md'),
    timestamp: ts(1720000000000), // 2024-07-03
    description: 'test entry',
    ...overrides,
  };
}

describe('FileHistoryAdapter', () => {
  describe('record', () => {
    it('빈 이력에 새 항목을 기록한다', async () => {
      const vault = createMockVault({
        readFileRaw: vi.fn().mockResolvedValue(null),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await adapter.record(makeEntry());

      expect(vault.writeFileRaw).toHaveBeenCalledWith(
        '.vaultend/history/2024-07.json',
        expect.any(String),
      );
      const written = JSON.parse((vault.writeFileRaw as any).mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('entry-1');
    });

    it('기존 이력에 추가한다', async () => {
      const existing = [makeEntry({ id: 'existing-1' })];
      const vault = createMockVault({
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(existing)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await adapter.record(makeEntry({ id: 'new-1' }));

      const written = JSON.parse((vault.writeFileRaw as any).mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(written[1].id).toBe('new-1');
    });

    it('다른 월의 항목은 다른 파일에 저장된다', async () => {
      const vault = createMockVault({
        readFileRaw: vi.fn().mockResolvedValue(null),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await adapter.record(makeEntry({ timestamp: ts(1735689600000) })); // 2025-01

      expect(vault.writeFileRaw).toHaveBeenCalledWith(
        '.vaultend/history/2025-01.json',
        expect.any(String),
      );
    });
  });

  describe('list', () => {
    it('모든 이력 파일을 합쳐서 최신순 반환한다', async () => {
      const entries1 = [makeEntry({ id: 'a', timestamp: ts(1000) })];
      const entries2 = [makeEntry({ id: 'b', timestamp: ts(2000) })];

      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue([
          '.vaultend/history/2024-01.json',
          '.vaultend/history/2024-02.json',
        ]),
        readFileRaw: vi.fn()
          .mockResolvedValueOnce(JSON.stringify(entries1))
          .mockResolvedValueOnce(JSON.stringify(entries2)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      const result = await adapter.list();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b'); // Newest first
      expect(result[1].id).toBe('a');
    });

    it('limit 필터를 적용한다', async () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: ts(1000) }),
        makeEntry({ id: 'b', timestamp: ts(2000) }),
        makeEntry({ id: 'c', timestamp: ts(3000) }),
      ];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      const result = await adapter.list({ limit: 2 });

      expect(result).toHaveLength(2);
    });

    it('since 필터를 적용한다', async () => {
      const entries = [
        makeEntry({ id: 'old', timestamp: ts(1000) }),
        makeEntry({ id: 'new', timestamp: ts(5000) }),
      ];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      const result = await adapter.list({ since: ts(3000) });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new');
    });

    it('action 필터를 적용한다', async () => {
      const entries = [
        makeEntry({ id: 'a', action: 'classify' }),
        makeEntry({ id: 'b', action: 'move' }),
      ];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      const result = await adapter.list({ action: 'classify' });

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('classify');
    });

    it('이력 파일이 없으면 빈 배열을 반환한다', async () => {
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue([]),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      const result = await adapter.list();
      expect(result).toHaveLength(0);
    });

    it('파일 내용이 잘못된 JSON이면 빈 배열로 처리한다', async () => {
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue('not-json{{{'),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      const result = await adapter.list();
      expect(result).toHaveLength(0);
    });
  });

  describe('undo', () => {
    it('previousContent가 있으면 노트를 복원하고 restore 기록을 남긴다', async () => {
      const entries = [makeEntry({ id: 'entry-1', previousContent: 'old content' })];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await adapter.undo('entry-1');

      expect(vault.writeNote).toHaveBeenCalledWith(np('test.md'), 'old content');
      expect(vault.writeFileRaw).toHaveBeenCalled();
      const written = JSON.parse((vault.writeFileRaw as any).mock.calls[0][1]);
      const restoreEntry = written.find((e: any) => e.action === 'restore');
      expect(restoreEntry).toBeDefined();
      expect(restoreEntry.description).toContain('복원');
    });

    it('tag-merge 항목은 모든 affectedFiles의 내용을 복원한다', async () => {
      const entries = [makeEntry({
        id: 'merge-1',
        action: 'tag-merge',
        notePath: np('a.md'),
        metadata: {
          keepTag: '#typescript',
          replacedTags: ['#ts'],
          mergedNoteCount: 2,
          affectedFiles: [
            { path: 'a.md', previousContent: '---\ntags: [ts]\n---\n# A' },
            { path: 'b.md', previousContent: '---\ntags: [ts, react]\n---\n# B' },
          ],
        },
      })];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await adapter.undo('merge-1');

      expect(vault.writeNote).toHaveBeenCalledTimes(2);
      expect(vault.writeNote).toHaveBeenCalledWith(np('a.md'), '---\ntags: [ts]\n---\n# A');
      expect(vault.writeNote).toHaveBeenCalledWith(np('b.md'), '---\ntags: [ts, react]\n---\n# B');

      const written = JSON.parse((vault.writeFileRaw as any).mock.calls[0][1]);
      const restoreEntry = written.find((e: any) => e.action === 'restore');
      expect(restoreEntry).toBeDefined();
      expect(restoreEntry.description).toContain('2/2개 노트');

      const original = written.find((e: any) => e.id === 'merge-1');
      expect(original.metadata.keepTag).toBe('#typescript');
      expect(original.metadata.affectedFiles).toBeUndefined();
    });

    it('tag-merge undo 중 일부 파일 실패 시 나머지는 복원하고 실패를 기록한다', async () => {
      const entries = [makeEntry({
        id: 'merge-2',
        action: 'tag-merge',
        notePath: np('a.md'),
        metadata: {
          keepTag: '#ts',
          affectedFiles: [
            { path: 'a.md', previousContent: 'content-a' },
            { path: 'b.md', previousContent: 'content-b' },
          ],
        },
      })];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
        writeNote: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('disk full')),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await adapter.undo('merge-2');

      expect(vault.writeNote).toHaveBeenCalledTimes(2);
      const written = JSON.parse((vault.writeFileRaw as any).mock.calls[0][1]);
      const restoreEntry = written.find((e: any) => e.action === 'restore');
      expect(restoreEntry.description).toContain('1/2개 노트');
      expect(restoreEntry.description).toContain('실패: b.md');
    });

    it('tag-merge 빈 affectedFiles는 HistoryEntryNotFoundError를 던진다', async () => {
      const entries = [makeEntry({
        id: 'merge-3',
        action: 'tag-merge',
        notePath: np('a.md'),
        metadata: { keepTag: '#ts', affectedFiles: [] },
      })];
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify(entries)),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await expect(adapter.undo('merge-3')).rejects.toThrow(HistoryEntryNotFoundError);
    });

    it('해당 ID가 없으면 HistoryEntryNotFoundError를 던진다', async () => {
      const vault = createMockVault({
        listFiles: vi.fn().mockResolvedValue(['f.json']),
        readFileRaw: vi.fn().mockResolvedValue(JSON.stringify([makeEntry()])),
      });
      const adapter = new FileHistoryAdapter(vault, createMockClock());

      await expect(adapter.undo('nonexistent')).rejects.toThrow(HistoryEntryNotFoundError);
    });
  });
});
