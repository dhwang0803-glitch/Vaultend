import { ItemView, WorkspaceLeaf, Setting, Notice } from 'obsidian';
import { GetHistoryUseCase } from '../application/usecases/GetHistoryUseCase';
import { HistoryPort } from '../application/ports/HistoryPort';
import { HistoryEntry } from '../domain/models/HistoryEntry';
import { MAINTENANCE_LOG_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
import { t, formatDate } from '../i18n';
import { localizeError } from './localizeError';

export { MAINTENANCE_LOG_VIEW_TYPE };

export class MaintenanceLogView extends ItemView {
  private refreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly getHistory: GetHistoryUseCase,
    private readonly historyPort: HistoryPort,
  ) {
    super(leaf);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 300);
  }

  getViewType(): string {
    return MAINTENANCE_LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('log.viewTitle');
  }

  getIcon(): string {
    return 'wrench';
  }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on(HISTORY_CHANGED_EVENT, () => this.scheduleRefresh()),
    );
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl)
      .setName(t('log.title'))
      .addExtraButton(btn => btn
        .setIcon('refresh-cw')
        .setTooltip(t('log.refresh'))
        .onClick(() => this.refresh()),
      );

    const entries = await this.getHistory.execute({ limit: 50 });

    if (entries.length === 0) {
      contentEl.createEl('p', {
        text: t('log.empty'),
        cls: 'vaultend-empty',
      });
      return;
    }

    for (const entry of entries) {
      const setting = new Setting(contentEl);
      const time = formatDate(entry.timestamp);
      setting.setName(`[${time}] ${entry.action}`);
      setting.setDesc(this.formatDescription(entry));

      const canUndo = entry.previousContent !== undefined
        || (entry.action === 'archive' && entry.metadata?.archivedTo)
        || (entry.action === 'tag-merge' && Array.isArray(entry.metadata?.affectedFiles) && entry.metadata!.affectedFiles.length > 0);
      if (canUndo) {
        setting.addButton(btn => btn
          .setButtonText(t('log.undo'))
          .setDestructive()
          .onClick(async () => {
            try {
              await this.historyPort.undo(entry.id);
              new Notice(t('undo.success'));
              this.app.workspace.trigger(HISTORY_CHANGED_EVENT, entry.id);
            } catch (err) {
              new Notice(t('undo.failed', { error: localizeError(err) }));
            }
          }),
        );
      }
    }
  }

  private formatDescription(entry: HistoryEntry): string {
    const meta = entry.metadata ?? {};
    const path = entry.notePath;

    switch (entry.action) {
      case 'delete':
        return t('historyDesc.delete', { path });
      case 'create':
        return t('historyDesc.create', { name: path.replace(/\.md$/, '').split('/').pop() ?? path });
      case 'archive':
        if (meta.archivedTo) {
          const folder = String(meta.archivedTo).replace(/\/[^/]+$/, '');
          return t('historyDesc.archive', { path, folder });
        }
        return entry.description;
      case 'tag-merge':
        if (meta.keepTag && Array.isArray(meta.replacedTags)) {
          return t('historyDesc.tagMerge', {
            replacedTags: (meta.replacedTags as string[]).join(', '),
            keepTag: String(meta.keepTag),
            count: String(meta.mergedNoteCount ?? 0),
          });
        }
        return entry.description;
      case 'tag-add':
        if (Array.isArray(meta.tags) && (meta.tags as string[]).length > 0) {
          return t('historyDesc.tagAdd', { tags: (meta.tags as string[]).join(', '), path });
        }
        return t('historyDesc.tagAddSimple', { path });
      case 'link-remove':
        if (meta.targetLink && meta.lineNumber) {
          return t('historyDesc.linkRemove', { link: String(meta.targetLink), path, line: String(meta.lineNumber) });
        }
        return t('historyDesc.linkRemoveSimple', { path });
      case 'link-add':
        if (meta.linkCount) {
          return t('historyDesc.linkAdd', { count: String(meta.linkCount), path });
        }
        return t('historyDesc.linkAddSimple', { path });
      case 'dismiss':
        if (meta.issueType) {
          return t('historyDesc.dismiss', { type: String(meta.issueType), id: path.replace(/\.md$/, '') });
        }
        return t('historyDesc.dismissSimple', { id: path.replace(/\.md$/, '') });
      case 'classify':
        return t('historyDesc.classify', { path });
      case 'restore': {
        const restoredAction = this.detectRestoredAction(entry);
        if (restoredAction) {
          return t('historyDesc.restore', { path: path || restoredAction, action: restoredAction });
        }
        return t('historyDesc.restoreSimple', { path });
      }
      default:
        return entry.description;
    }
  }

  private detectRestoredAction(entry: HistoryEntry): string {
    const desc = entry.description;
    if (desc.includes('tag-merge') || desc.includes('태그 병합')) return 'tag-merge';
    if (desc.includes('archive') || desc.includes('아카이브')) return 'archive';
    if (desc.includes('classify') || desc.includes('분류')) return 'classify';
    if (desc.includes('link-remove') || desc.includes('링크 제거')) return 'link-remove';
    if (desc.includes('link-add') || desc.includes('링크')) return 'link-add';
    if (desc.includes('delete') || desc.includes('삭제')) return 'delete';
    if (desc.includes('tag-add') || desc.includes('태그 추가')) return 'tag-add';
    return '';
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.contentEl.empty();
  }
}
