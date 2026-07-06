import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VaultAccessPort } from '../application/ports/VaultAccessPort';
import { ConfigPort } from '../application/ports/ConfigPort';

export const INBOX_STATUS_VIEW_TYPE = 'knowledge-maintenance-inbox-status';

/**
 * Inbox 상태 사이드바 뷰 — Inbox 폴더의 처리 현황을 표시한다.
 *
 * 미처리/처리완료 노트 수, 최근 처리된 노트 목록 등을 보여준다.
 */
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
    return 'Inbox Status';
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

    contentEl.createEl('h4', { text: 'Inbox 처리 현황' });

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
    statsEl.createEl('p', { text: `총 노트: ${inboxNotes.length}` });
    statsEl.createEl('p', { text: `미처리: ${unprocessedCount}` });
    statsEl.createEl('p', { text: `처리완료: ${processedCount}` });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
