import { ItemView, WorkspaceLeaf } from 'obsidian';
import { GetHistoryUseCase } from '../application/usecases/GetHistoryUseCase';
import { MAINTENANCE_LOG_VIEW_TYPE } from '../constants';
import { t, formatDate } from '../i18n';

export { MAINTENANCE_LOG_VIEW_TYPE };

export class MaintenanceLogView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly getHistory: GetHistoryUseCase,
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
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h4', { text: t('log.title') });

    const entries = await this.getHistory.execute({ limit: 50 });

    if (entries.length === 0) {
      contentEl.createEl('p', {
        text: t('log.empty'),
        cls: 'knowledge-maintenance-empty',
      });
      return;
    }

    const listEl = contentEl.createEl('ul', { cls: 'knowledge-maintenance-log-list' });
    for (const entry of entries) {
      const li = listEl.createEl('li');
      const time = formatDate(entry.timestamp as number);
      li.createEl('span', { text: `[${time}] `, cls: 'log-timestamp' });
      li.createEl('span', { text: `${entry.action}: `, cls: 'log-action' });
      li.createEl('span', { text: entry.description, cls: 'log-description' });
    }
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
