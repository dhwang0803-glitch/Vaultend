import { App, Component, Modal, MarkdownRenderer, TextAreaComponent, ButtonComponent, Notice, TFile } from 'obsidian';
import { QuickAskUseCase } from '../application/usecases/QuickAskUseCase';
import { QuickAskRequest, QuickAskResult } from '../domain/models/QuickAskModels';
import { SaveTarget } from '../domain/models/SaveTarget';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export class QuickAskModal extends Modal {
  private questionInput: TextAreaComponent | null = null;
  private resultContainer: HTMLElement | null = null;
  private lastResult: QuickAskResult | null = null;
  private isAsking = false;
  private readonly renderComponent = new Component();
  private previewContainer: HTMLElement | null = null;
  private activeRefLink: HTMLElement | null = null;
  private previewRequestId = 0;
  private viewportHandler: (() => void) | null = null;

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

    const inputContainer = contentEl.createDiv('quick-ask-input');
    this.questionInput = new TextAreaComponent(inputContainer);
    this.questionInput.setPlaceholder(t('quickAsk.placeholder'));
    this.questionInput.inputEl.rows = 3;
    this.questionInput.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleAsk();
      }
    });

    const buttonContainer = contentEl.createDiv('quick-ask-buttons');
    new ButtonComponent(buttonContainer)
      .setButtonText(t('quickAsk.askButton'))
      .setCta()
      .onClick(() => this.handleAsk());
    new ButtonComponent(buttonContainer)
      .setButtonText(t('quickAsk.closeButton'))
      .onClick(() => this.close());

    this.resultContainer = contentEl.createDiv('quick-ask-result');
    this.resultContainer.style.display = 'none';

    this.setupMobileKeyboardHandler();
  }

  onClose(): void {
    if (this.viewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.viewportHandler);
      this.viewportHandler = null;
    }
    this.containerEl.style.removeProperty('--vaultend-keyboard-offset');
    this.renderComponent.unload();
    this.contentEl.empty();
  }

  private setupMobileKeyboardHandler(): void {
    const vv = window.visualViewport;
    if (!vv) return;

    this.viewportHandler = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      const modalEl = this.containerEl.querySelector('.modal') as HTMLElement | null;
      if (!modalEl) return;
      if (keyboardHeight > 100) {
        modalEl.style.transform = `translateY(${-keyboardHeight / 2}px)`;
      } else {
        modalEl.style.removeProperty('transform');
      }
    };

    vv.addEventListener('resize', this.viewportHandler);
  }

  private async handleAsk(): Promise<void> {
    if (this.isAsking) return;

    const question = this.questionInput?.getValue()?.trim();
    if (!question) {
      new Notice(t('quickAsk.emptyQuestion'));
      return;
    }

    this.isAsking = true;

    if (this.resultContainer) {
      this.resultContainer.style.display = 'block';
      this.resultContainer.empty();
      this.resultContainer.createEl('p', { text: t('quickAsk.loading') });
    }

    try {
      const request: QuickAskRequest = {
        question,
        maxContextChunks: 5,
        saveTarget: this.createSaveTarget(),
        autoLink: true,
      };

      this.lastResult = await this.quickAsk.execute(request);
      await this.renderResult(this.lastResult);
    } catch (err) {
      if (this.resultContainer) {
        const errorMsg = t('quickAsk.error', { error: localizeError(err) });
        this.resultContainer.empty();
        this.resultContainer.createEl('p', { text: errorMsg, cls: 'maintenance-result-error' });
      }
    } finally {
      this.isAsking = false;
    }
  }

  private async renderResult(result: QuickAskResult): Promise<void> {
    if (!this.resultContainer) return;

    this.resultContainer.empty();

    // Truncation warning (#65)
    if (result.truncated) {
      this.resultContainer.createEl('div', {
        text: t('quickAsk.truncated'),
        cls: 'quick-ask-truncation-warning',
      });
    }

    const answerEl = this.resultContainer.createDiv('quick-ask-answer');
    await MarkdownRenderer.renderMarkdown(result.answer, answerEl, '', this.renderComponent);

    // Referenced notes section (#60)
    if (result.referencedNotes.length > 0) {
      const refEl = this.resultContainer.createDiv('quick-ask-references');
      refEl.createEl('strong', { text: t('quickAsk.references') });
      const refList = refEl.createEl('ul');
      for (const notePath of result.referencedNotes) {
        const pathStr = notePath as string;
        const displayName = this.resolveDisplayName(pathStr, result.referencedNotes);
        const li = refList.createEl('li');
        const link = li.createEl('a', { text: displayName, cls: 'internal-link' });
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.showNotePreview(pathStr, link);
        });
      }
    }

    this.previewContainer = this.resultContainer.createDiv('quick-ask-preview');
    this.previewContainer.style.display = 'none';

    const footerEl = this.resultContainer.createDiv('quick-ask-footer');

    const metaParts = [
      t('quickAsk.tokens', { count: result.tokenUsage.totalTokens.toLocaleString() }),
      t('quickAsk.cost', { amount: result.tokenUsage.estimatedCostUsd.toFixed(4) }),
    ];
    if (result.suggestedTags.length > 0) {
      metaParts.push(t('quickAsk.suggestedTags', { tags: result.suggestedTags.join(', ') }));
    }
    footerEl.createEl('small', { text: metaParts.join(' · '), cls: 'quick-ask-meta' });

    const actionsEl = footerEl.createDiv('quick-ask-actions');
    const savedPath = result.savedTo as string;
    const fileName = savedPath.split('/').pop()?.replace('.md', '') ?? savedPath;

    new ButtonComponent(actionsEl)
      .setButtonText(`📄 ${fileName}`)
      .setCta()
      .setTooltip(savedPath)
      .onClick(async () => {
        const file = this.app.vault.getAbstractFileByPath(savedPath);
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf(false).openFile(file);
        }
        this.close();
      });

    new ButtonComponent(actionsEl)
      .setButtonText(t('btn.close'))
      .onClick(() => this.close());
  }

  private async showNotePreview(pathStr: string, linkEl: HTMLElement): Promise<void> {
    if (!this.previewContainer) return;

    if (this.activeRefLink) {
      this.activeRefLink.removeClass('is-active');
    }

    if (this.activeRefLink === linkEl && this.previewContainer.style.display !== 'none') {
      this.previewContainer.style.display = 'none';
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
      this.previewContainer.style.display = 'block';
      this.previewContainer.createEl('p', { text: `Note not found: ${pathStr}`, cls: 'maintenance-result-error' });
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    if (requestId !== this.previewRequestId) return;
    const displayName = pathStr.split('/').pop()?.replace(/\.md$/, '') ?? pathStr;

    this.previewContainer.empty();
    this.previewContainer.style.display = 'block';

    const header = this.previewContainer.createDiv('quick-ask-preview-header');
    header.createEl('strong', { text: displayName });
    const closeBtn = header.createEl('span', { text: '×', cls: 'quick-ask-preview-close' });
    closeBtn.addEventListener('click', () => {
      this.previewContainer!.style.display = 'none';
      if (this.activeRefLink) {
        this.activeRefLink.removeClass('is-active');
        this.activeRefLink = null;
      }
    });

    const body = this.previewContainer.createDiv('quick-ask-preview-body');
    await MarkdownRenderer.render(this.app, content, body, pathStr, this.renderComponent);

    this.previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private resolveDisplayName(pathStr: string, allRefs: ReadonlyArray<import('../domain/values/NotePath').NotePath>): string {
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
