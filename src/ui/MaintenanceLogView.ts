import { ItemView, WorkspaceLeaf, Setting, Notice } from 'obsidian';
import { GetHistoryUseCase } from '../application/usecases/GetHistoryUseCase';
import { HistoryPort } from '../application/ports/HistoryPort';
import { MAINTENANCE_LOG_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
import { t, formatDate } from '../i18n';
import { localizeError } from './localizeError';

export { MAINTENANCE_LOG_VIEW_TYPE };

export class MaintenanceLogView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly getHistory: GetHistoryUseCase,
    private readonly historyPort: HistoryPort,
  ) {
    super(leaf);
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
      this.app.workspace.on(HISTORY_CHANGED_EVENT, () => this.refresh()),
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
      const time = formatDate(entry.timestamp as number);
      setting.setName(`[${time}] ${entry.action}`);
      setting.setDesc(entry.description);

      const canUndo = entry.previousContent !== undefined
        || (entry.action === 'archive' && entry.metadata?.archivedTo);
      if (canUndo) {
        setting.addButton(btn => btn
          .setButtonText(t('log.undo'))
          .setWarning()
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

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
