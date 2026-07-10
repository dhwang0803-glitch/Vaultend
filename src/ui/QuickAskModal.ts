import { App, Component, Modal, MarkdownRenderer, TextAreaComponent, ButtonComponent, Notice, TFile } from 'obsidian';
import { QuickAskUseCase } from '../application/usecases/QuickAskUseCase';
import { QuickAskRequest, QuickAskResult } from '../domain/models/QuickAskModels';
import { SaveTarget } from '../domain/models/SaveTarget';

export class QuickAskModal extends Modal {
  private questionInput: TextAreaComponent | null = null;
  private resultContainer: HTMLElement | null = null;
  private lastResult: QuickAskResult | null = null;
  private readonly renderComponent = new Component();

  constructor(
    app: App,
    private readonly quickAsk: QuickAskUseCase,
    private readonly defaultSaveTarget: SaveTarget,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderComponent.load();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('knowledge-maintenance-quick-ask');

    contentEl.createEl('h2', { text: 'Quick Ask' });

    const inputContainer = contentEl.createDiv('quick-ask-input');
    this.questionInput = new TextAreaComponent(inputContainer);
    this.questionInput.setPlaceholder('질문을 입력하세요... (Ctrl+Enter로 전송)');
    this.questionInput.inputEl.rows = 3;
    this.questionInput.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleAsk();
      }
    });

    const buttonContainer = contentEl.createDiv('quick-ask-buttons');
    new ButtonComponent(buttonContainer)
      .setButtonText('질문하기')
      .setCta()
      .onClick(() => this.handleAsk());
    new ButtonComponent(buttonContainer)
      .setButtonText('닫기')
      .onClick(() => this.close());

    this.resultContainer = contentEl.createDiv('quick-ask-result');
    this.resultContainer.style.display = 'none';
  }

  onClose(): void {
    this.renderComponent.unload();
    this.contentEl.empty();
  }

  private async handleAsk(): Promise<void> {
    const question = this.questionInput?.getValue()?.trim();
    if (!question) {
      new Notice('질문을 입력해주세요.');
      return;
    }

    if (this.resultContainer) {
      this.resultContainer.style.display = 'block';
      this.resultContainer.innerHTML = '<p>AI에게 질문하는 중...</p>';
    }

    try {
      const request: QuickAskRequest = {
        question,
        maxContextChunks: 5,
        saveTarget: this.defaultSaveTarget,
        autoTag: true,
        autoLink: true,
      };

      this.lastResult = await this.quickAsk.execute(request);
      await this.renderResult(this.lastResult);
    } catch (err) {
      if (this.resultContainer) {
        this.resultContainer.innerHTML =
          `<p style="color: var(--text-error);">오류: ${err instanceof Error ? err.message : String(err)}</p>`;
      }
    }
  }

  private async renderResult(result: QuickAskResult): Promise<void> {
    if (!this.resultContainer) return;

    this.resultContainer.empty();

    const answerEl = this.resultContainer.createDiv('quick-ask-answer');
    await MarkdownRenderer.renderMarkdown(result.answer, answerEl, '', this.renderComponent);

    const footerEl = this.resultContainer.createDiv('quick-ask-footer');

    const metaParts = [
      `토큰: ${result.tokenUsage.totalTokens.toLocaleString()}`,
      `비용: $${result.tokenUsage.estimatedCostUsd.toFixed(4)}`,
    ];
    if (result.suggestedTags.length > 0) {
      metaParts.push(`태그: ${result.suggestedTags.join(', ')}`);
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
      .setButtonText('닫기')
      .onClick(() => this.close());
  }
}
