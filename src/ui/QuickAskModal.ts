import { App, Component, Modal, MarkdownRenderer, ButtonComponent, Notice, TFile } from 'obsidian';
import { QuickAskUseCase } from '../application/usecases/QuickAskUseCase';
import { ChatSession } from '../domain/models/QuickAskModels';
import { SaveTarget } from '../domain/models/SaveTarget';
import { NotePath } from '../domain/values/NotePath';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export class QuickAskModal extends Modal {
  private session: ChatSession | null = null;
  private chatContainer: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: ButtonComponent | null = null;
  private statusBar: HTMLElement | null = null;
  private saved = false;
  private isAsking = false;
  private readonly renderComponent = new Component();
  private previewContainer: HTMLElement | null = null;
  private activeRefLink: HTMLElement | null = null;
  private previewRequestId = 0;

  constructor(
    app: App,
    private readonly quickAsk: QuickAskUseCase,
    private readonly createSaveTarget: () => SaveTarget,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderComponent.load();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-quick-ask');

    contentEl.createEl('h2', { text: t('quickAsk.title') });

    this.chatContainer = contentEl.createDiv('quick-ask-chat');

    this.previewContainer = contentEl.createDiv('quick-ask-preview');
    this.previewContainer.addClass('vaultend-hidden');

    const inputBar = contentEl.createDiv('quick-ask-input-bar');
    this.inputEl = inputBar.createEl('textarea', {
      cls: 'quick-ask-chat-input',
      attr: { placeholder: t('quickAsk.chatPlaceholder'), rows: '2' },
    });
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = new ButtonComponent(inputBar)
      .setButtonText(t('quickAsk.sendButton'))
      .setCta()
      .onClick(() => this.handleSend());

    this.statusBar = contentEl.createDiv('quick-ask-status-bar');
    this.renderStatusBar();
  }

  onClose(): void {
    if (!this.saved && this.session && this.session.messages.length >= 2) {
      void this.autoSave();
    }
    this.renderComponent.unload();
    this.contentEl.empty();
  }

  private async autoSave(): Promise<void> {
    if (!this.session) return;
    try {
      await this.quickAsk.saveConversation(this.session, this.createSaveTarget());
    } catch {
      // modal is closing — best-effort save
    }
  }

  private async handleSend(): Promise<void> {
    if (this.isAsking || !this.inputEl) return;

    const question = this.inputEl.value.trim();
    if (!question) {
      new Notice(t('quickAsk.emptyQuestion'));
      return;
    }

    this.isAsking = true;
    this.inputEl.value = '';
    this.inputEl.disabled = true;
    this.sendBtn?.setDisabled(true);

    this.appendUserMessage(question);
    const loadingEl = this.appendLoading();

    try {
      const { reply, session, truncated } = await this.quickAsk.chat(
        question,
        this.session,
        5,
      );
      this.session = session;
      this.saved = false;
      loadingEl.remove();

      await this.appendAssistantMessage(reply, truncated);
      this.renderReferences();
      this.renderStatusBar();
    } catch (err) {
      loadingEl.remove();
      this.appendErrorMessage(localizeError(err));
    } finally {
      this.isAsking = false;
      if (this.inputEl) {
        this.inputEl.disabled = false;
        this.inputEl.focus();
      }
      this.sendBtn?.setDisabled(false);
    }
  }

  private appendUserMessage(text: string): void {
    if (!this.chatContainer) return;
    const msgEl = this.chatContainer.createDiv('quick-ask-msg quick-ask-msg-user');
    msgEl.createEl('p', { text });
    this.scrollToBottom();
  }

  private async appendAssistantMessage(text: string, truncated: boolean): Promise<void> {
    if (!this.chatContainer) return;
    const msgEl = this.chatContainer.createDiv('quick-ask-msg quick-ask-msg-assistant');
    if (truncated) {
      msgEl.createEl('div', {
        text: t('quickAsk.truncated'),
        cls: 'quick-ask-truncation-warning',
      });
    }
    const contentEl = msgEl.createDiv('quick-ask-msg-content');
    await MarkdownRenderer.renderMarkdown(text, contentEl, '', this.renderComponent);
    this.scrollToBottom();
  }

  private appendLoading(): HTMLElement {
    if (!this.chatContainer) return createDiv();
    const wrapper = this.chatContainer.createDiv('quick-ask-msg quick-ask-msg-assistant quick-ask-loading');
    const dots = wrapper.createDiv('quick-ask-loading-dots');
    for (let i = 0; i < 3; i++) {
      dots.createSpan({ cls: 'quick-ask-dot' });
    }
    wrapper.createEl('span', { text: t('quickAsk.loading'), cls: 'quick-ask-loading-text' });
    this.scrollToBottom();
    return wrapper;
  }

  private appendErrorMessage(error: string): void {
    if (!this.chatContainer) return;
    const msgEl = this.chatContainer.createDiv('quick-ask-msg quick-ask-msg-error');
    msgEl.createEl('p', { text: t('quickAsk.error', { error }), cls: 'maintenance-result-error' });
    this.scrollToBottom();
  }

  private renderReferences(): void {
    if (!this.session || this.session.referencedNotes.length === 0 || !this.chatContainer) return;

    const existing = this.chatContainer.querySelector('.quick-ask-references');
    if (existing) existing.remove();

    const refEl = this.chatContainer.createDiv('quick-ask-references');
    const toggle = refEl.createEl('details');
    toggle.createEl('summary', { text: `${t('quickAsk.references')} (${this.session.referencedNotes.length})` });

    const refList = toggle.createEl('ul');
    for (const notePath of this.session.referencedNotes) {
      const pathStr = notePath as string;
      const displayName = this.resolveDisplayName(pathStr, this.session.referencedNotes);
      const li = refList.createEl('li');
      const link = li.createEl('a', { text: displayName, cls: 'internal-link' });
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.showNotePreview(pathStr, link);
      });
    }
  }

  private renderStatusBar(): void {
    if (!this.statusBar) return;
    this.statusBar.empty();

    const metaEl = this.statusBar.createDiv('quick-ask-status-meta');
    if (this.session) {
      const usage = this.session.totalTokenUsage;
      metaEl.createEl('span', {
        text: `${t('quickAsk.tokens', { count: usage.totalTokens.toLocaleString() })} · ${t('quickAsk.cost', { amount: usage.estimatedCostUsd.toFixed(4) })}`,
        cls: 'quick-ask-meta',
      });
    }

    const actionsEl = this.statusBar.createDiv('quick-ask-status-actions');
    if (this.saved) {
      actionsEl.createEl('span', { text: t('quickAsk.saved'), cls: 'quick-ask-saved-label' });
    } else if (this.session && this.session.messages.length >= 2) {
      new ButtonComponent(actionsEl)
        .setButtonText(t('quickAsk.saveConversation'))
        .onClick(async () => {
          if (!this.session) return;
          try {
            const savedPath = await this.quickAsk.saveConversation(this.session, this.createSaveTarget());
            this.saved = true;
            this.renderStatusBar();
            new Notice(`${t('quickAsk.saved')}: ${(savedPath as string).split('/').pop()}`);
          } catch (err) {
            new Notice(localizeError(err));
          }
        });
    }

    new ButtonComponent(actionsEl)
      .setButtonText(t('quickAsk.closeButton'))
      .onClick(() => this.close());
  }

  private scrollToBottom(): void {
    if (this.chatContainer) {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
  }

  private async showNotePreview(pathStr: string, linkEl: HTMLElement): Promise<void> {
    if (!this.previewContainer) return;

    if (this.activeRefLink) {
      this.activeRefLink.removeClass('is-active');
    }

    if (this.activeRefLink === linkEl && !this.previewContainer.hasClass('vaultend-hidden')) {
      this.previewContainer.addClass('vaultend-hidden');
      this.activeRefLink = null;
      return;
    }

    this.activeRefLink = linkEl;
    linkEl.addClass('is-active');
    const requestId = ++this.previewRequestId;

    const file = this.app.vault.getAbstractFileByPath(pathStr);
    if (!(file instanceof TFile)) {
      if (requestId !== this.previewRequestId) return;
      this.previewContainer.empty();
      this.previewContainer.removeClass('vaultend-hidden');
      this.previewContainer.createEl('p', { text: `Note not found: ${pathStr}`, cls: 'maintenance-result-error' });
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    if (requestId !== this.previewRequestId) return;
    const displayName = pathStr.split('/').pop()?.replace(/\.md$/, '') ?? pathStr;

    this.previewContainer.empty();
    this.previewContainer.removeClass('vaultend-hidden');

    const header = this.previewContainer.createDiv('quick-ask-preview-header');
    header.createEl('strong', { text: displayName });
    const closeBtn = header.createEl('span', { text: '×', cls: 'quick-ask-preview-close' });
    closeBtn.addEventListener('click', () => {
      this.previewContainer!.addClass('vaultend-hidden');
      if (this.activeRefLink) {
        this.activeRefLink.removeClass('is-active');
        this.activeRefLink = null;
      }
    });

    const body = this.previewContainer.createDiv('quick-ask-preview-body');
    await MarkdownRenderer.render(this.app, content, body, pathStr, this.renderComponent);

    this.previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private resolveDisplayName(pathStr: string, allRefs: ReadonlyArray<NotePath>): string {
    const basename = pathStr.split('/').pop()?.replace(/\.md$/, '') ?? pathStr;

    const duplicates = allRefs.filter(n => {
      const other = (n as string).split('/').pop()?.replace(/\.md$/, '');
      return other === basename;
    });

    if (duplicates.length <= 1) {
      return basename;
    }

    const parts = pathStr.replace(/\.md$/, '').split('/');
    if (parts.length <= 1) {
      return basename;
    }

    const parentSlug = `${parts[parts.length - 2]}/${basename}`;
    const stillAmbiguous = duplicates.filter(n => {
      const rel = (n as string).replace(/\.md$/, '');
      return rel.endsWith(parentSlug);
    });

    if (stillAmbiguous.length > 1) {
      return pathStr.replace(/\.md$/, '');
    }

    return parentSlug;
  }
}
