import { HistoryPort, HistoryFilter } from '../../application/ports/HistoryPort';
import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { ClockPort } from '../../application/ports/ClockPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { Timestamp } from '../../domain/values/Timestamp';
import { HistoryEntryNotFoundError } from '../../domain/errors/DomainErrors';
import { HISTORY_FOLDER } from '../../constants';
import { t } from '../../i18n';

/**
 * 파일 기반 변경 이력 어댑터.
 *
 * 이력을 Vault 내 JSON 파일로 관리한다.
 * 경로: .vaultend/history/YYYY-MM.json (월별 분할)
 */
export class FileHistoryAdapter implements HistoryPort {
  constructor(
    private readonly vault: VaultAccessPort,
    private readonly clock: ClockPort,
  ) {}

  async record(entry: HistoryEntry): Promise<void> {
    const monthKey = this.getMonthKey(entry.timestamp);
    const filePath = `${HISTORY_FOLDER}/${monthKey}.json`;

    const existing = await this.loadMonthEntries(filePath as NotePath);
    existing.push(entry);

    await this.vault.writeFileRaw(filePath, JSON.stringify(existing, null, 2));
  }

  async list(filter?: HistoryFilter): Promise<ReadonlyArray<HistoryEntry>> {
    // Load all history files and apply filter
    const historyFiles = await this.vault.listFiles(HISTORY_FOLDER, 'json');
    let allEntries: HistoryEntry[] = [];

    for (const filePath of historyFiles) {
      const entries = await this.loadMonthEntries(filePath as NotePath);
      allEntries = allEntries.concat(entries);
    }

    // Apply filter
    let filtered = allEntries;
    if (filter?.since) {
      filtered = filtered.filter(e => (e.timestamp as number) >= (filter.since as number));
    }
    if (filter?.until) {
      filtered = filtered.filter(e => (e.timestamp as number) <= (filter.until as number));
    }
    if (filter?.action) {
      filtered = filtered.filter(e => e.action === filter.action);
    }

    // Sort by newest first
    filtered.sort((a, b) => (b.timestamp as number) - (a.timestamp as number));

    if (filter?.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  async undo(entryId: string): Promise<void> {
    const historyFiles = await this.vault.listFiles(HISTORY_FOLDER, 'json');

    for (const filePath of historyFiles) {
      const entries = await this.loadMonthEntries(filePath as NotePath);
      const target = entries.find(e => e.id === entryId);
      if (!target) continue;

      if (target.action === 'tag-merge' && Array.isArray(target.metadata?.affectedFiles)) {
        const files = (target.metadata.affectedFiles as Array<{ path: string; previousContent: string }>)
          .filter(f => typeof f.path === 'string' && typeof f.previousContent === 'string');
        if (files.length === 0) break;

        const failed: string[] = [];
        for (const file of files) {
          try {
            await this.vault.writeNote(createNotePath(file.path), file.previousContent);
          } catch {
            failed.push(file.path);
          }
        }

        const idx = entries.indexOf(target);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-destructure to omit affectedFiles
        const { affectedFiles: _af, ...preservedMeta } = target.metadata;
        entries[idx] = { ...target, metadata: preservedMeta };

        const restored = files.length - failed.length;
        entries.push({
          id: crypto.randomUUID(),
          action: 'restore' as const,
          notePath: target.notePath,
          timestamp: this.clock.now(),
          description: t('historyDesc.restoreTagMerge', {
            restored: String(restored),
            total: String(files.length),
            failDetail: failed.length > 0 ? t('historyDesc.restoreTagMergeFail', { files: failed.join(', ') }) : '',
          }),
        });

        await this.vault.writeFileRaw(filePath, JSON.stringify(entries, null, 2));
        if (failed.length > 0) {
          console.warn(`[Vaultend] tag-merge undo partial failure: ${failed.join(', ')}`);
        }
        return;
      }

      if (target.action === 'archive' && target.metadata?.archivedTo) {
        const archivedPath = createNotePath(target.metadata.archivedTo as string);
        await this.vault.moveNote(archivedPath, target.notePath);

        const idx = entries.indexOf(target);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-destructure to omit metadata
        const { metadata: _cleared, ...rest } = target;
        entries[idx] = rest;

        entries.push({
          id: crypto.randomUUID(),
          action: 'restore' as const,
          notePath: target.notePath,
          timestamp: this.clock.now(),
          description: t('historyDesc.restore', { path: target.notePath as string, action: target.action }),
        });

        await this.vault.writeFileRaw(filePath, JSON.stringify(entries, null, 2));
        return;
      }

      if (target.previousContent !== undefined) {
        await this.vault.writeNote(target.notePath, target.previousContent);

        const idx = entries.indexOf(target);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-destructure to omit previousContent
        const { previousContent: _cleared, ...rest } = target;
        entries[idx] = rest;

        entries.push({
          id: crypto.randomUUID(),
          action: 'restore' as const,
          notePath: target.notePath,
          timestamp: this.clock.now(),
          description: t('historyDesc.restore', { path: target.notePath as string, action: target.action }),
        });

        await this.vault.writeFileRaw(filePath, JSON.stringify(entries, null, 2));
        return;
      }
    }

    throw new HistoryEntryNotFoundError(entryId);
  }

  private async loadMonthEntries(filePath: NotePath): Promise<HistoryEntry[]> {
    const raw = await this.vault.readFileRaw(filePath);
    if (!raw) return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as HistoryEntry[];
    } catch {
      console.warn(`[Vaultend] History file parse failed: ${filePath}`);
      return [];
    }
  }

  private getMonthKey(timestamp: Timestamp): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
}
