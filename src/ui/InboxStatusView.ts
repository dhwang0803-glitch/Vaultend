import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VaultAccessPort } from '../application/ports/VaultAccessPort';
import { ConfigPort } from '../application/ports/ConfigPort';
import { INBOX_STATUS_VIEW_TYPE } from '../constants';
import { t } from '../i18n';

export { INBOX_STATUS_VIEW_TYPE };

export class InboxStatusView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly vault: VaultAccessPort,
    private readonly config: ConfigPort,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return INBOX_STATUS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('inbox.viewTitle');
  }

  getIcon(): string {
    return 'inbox';
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h4', { text: t('inbox.title') });

    const settings = await this.config.getSettings();
    const inboxNotes = await this.vault.listNotes(settings.inboxFolder);

    let processedCount = 0;
    let unprocessedCount = 0;

    for (const notePath of inboxNotes) {
      const note = await this.vault.readNote(notePath);
      if (note?.metadata.isProcessed) {
        processedCount++;
      } else {
        unprocessedCount++;
      }
    }

    const statsEl = contentEl.createDiv('inbox-stats');
    statsEl.createEl('p', { text: t('inbox.total', { count: inboxNotes.length }) });
    statsEl.createEl('p', { text: t('inbox.unprocessed', { count: unprocessedCount }) });
    statsEl.createEl('p', { text: t('inbox.processed', { count: processedCount }) });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
