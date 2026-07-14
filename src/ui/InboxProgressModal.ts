import { App, ButtonComponent, Modal } from 'obsidian';
import { RunInboxProcessUseCase, InboxProcessResult } from '../application/usecases/RunInboxProcessUseCase';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export class InboxProgressModal extends Modal {
  private abortController: AbortController | null = null;
  private counterEl: HTMLElement | null = null;
  private currentNoteEl: HTMLElement | null = null;
  private barFillEl: HTMLElement | null = null;
  private processingPromise: Promise<void> | null = null;

  constructor(
    app: App,
    private readonly runInboxProcess: RunInboxProcessUseCase,
    private readonly onProcessingStateChange: (isProcessing: boolean) => void,
    private readonly targetFolder?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-inbox-progress');

    const title = this.targetFolder
      ? t('inboxProgress.folderTitle', { folder: this.targetFolder })
      : t('inboxProgress.title');
    contentEl.createEl('h2', { text: title });

    const status = contentEl.createDiv('inbox-progress-status');
    this.currentNoteEl = status.createEl('p', {
      cls: 'inbox-progress-current-note',
      text: ' ',
    });
    this.counterEl = status.createEl('p', {
      cls: 'inbox-progress-counter',
      text: '0 / 0',
    });

    const barContainer = status.createDiv('inbox-progress-bar-container');
    this.barFillEl = barContainer.createDiv('inbox-progress-bar-fill');

    const actions = contentEl.createDiv('inbox-progress-actions');
    new ButtonComponent(actions)
      .setButtonText(t('inboxProgress.cancel'))
      .setWarning()
      .onClick(() => this.abortController?.abort());

    this.processingPromise = this.startProcessing();
  }

  private async startProcessing(): Promise<void> {
    this.abortController = new AbortController();
    this.onProcessingStateChange(true);

    let result: InboxProcessResult;
    try {
      result = await this.runInboxProcess.execute({
        folder: this.targetFolder,
        onProgress: (info) => {
          if (this.counterEl) {
            this.counterEl.textContent = t('inboxProgress.counter', {
              current: info.current,
              total: info.total,
            });
          }
          if (this.currentNoteEl) {
            const basename = (info.currentNotePath as string)
              .split('/').pop()?.replace('.md', '') ?? '';
            this.currentNoteEl.textContent = basename;
          }
          if (this.barFillEl) {
            const pct = (info.current / info.total) * 100;
            this.barFillEl.style.width = `${pct}%`;
          }
        },
        signal: this.abortController.signal,
      });
    } catch (err) {
      this.onProcessingStateChange(false);
      this.renderError(err);
      return;
    }

    this.onProcessingStateChange(false);
    this.renderResult(result);
  }

  private renderResult(result: InboxProcessResult): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-inbox-progress');

    const title = result.cancelled
      ? t('inboxProgress.cancelledTitle')
      : t('inboxProgress.completeTitle');
    contentEl.createEl('h2', { text: title });

    const summary = contentEl.createDiv('inbox-progress-summary');
    summary.createEl('p', {
      text: t('inboxProgress.processed', { count: result.processedCount }),
    });
    summary.createEl('p', {
      text: t('inboxProgress.skipped', { count: result.skippedCount }),
    });

    if (result.errors.length > 0) {
      summary.createEl('p', {
        text: t('inboxProgress.errors', { count: result.errors.length }),
        cls: 'u-text-error',
      });

      const errorList = contentEl.createDiv('inbox-progress-error-list');
      const ul = errorList.createEl('ul');
      for (const err of result.errors) {
        const basename = (err.path as string)
          .split('/').pop()?.replace('.md', '') ?? '';
        ul.createEl('li', {
          text: t('inboxProgress.errorDetail', {
            path: basename,
            error: err.error,
          }),
        });
      }
    }

    const actions = contentEl.createDiv('inbox-progress-actions');
    new ButtonComponent(actions)
      .setButtonText(t('inboxProgress.close'))
      .setCta()
      .onClick(() => this.close());
  }

  private renderError(err: unknown): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-inbox-progress');

    contentEl.createEl('h2', { text: t('inboxProgress.errorTitle') });
    contentEl.createEl('p', {
      text: localizeError(err),
      cls: 'maintenance-result-error',
    });

    const actions = contentEl.createDiv('inbox-progress-actions');
    new ButtonComponent(actions)
      .setButtonText(t('inboxProgress.close'))
      .setCta()
      .onClick(() => this.close());
  }

  async onClose(): Promise<void> {
    this.abortController?.abort();
    if (this.processingPromise) {
      await this.processingPromise;
    }
    this.contentEl.empty();
  }
}
