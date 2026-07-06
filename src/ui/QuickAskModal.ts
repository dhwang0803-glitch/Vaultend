import { App, Modal, Setting, TextAreaComponent, ButtonComponent, Notice } from 'obsidian';
import { QuickAskUseCase } from '../application/usecases/QuickAskUseCase';
import { QuickAskRequest, QuickAskResult } from '../domain/models/QuickAskModels';
import { SaveTarget } from '../domain/models/SaveTarget';

/**
 * Quick Ask 모달 — 질문 입력, 결과 표시, 저장 옵션을 제공한다.
 *
 * 플로우:
 * 1. 사용자가 질문을 입력하고 "질문하기" 버튼 클릭
 * 2. 로딩 표시와 함께 AI 호출 실행
 * 3. 결과를 모달 내에 마크다운으로 렌더링
 * 4. 저장 대상(새 노트 / Daily Note / 기존 노트)을 선택하고 저장
 */
export class QuickAskModal extends Modal {
  private questionInput: TextAreaComponent | null = null;
  private resultContainer: HTMLElement | null = null;
  private lastResult: QuickAskResult | null = null;

  constructor(
    app: App,
    private readonly quickAsk: QuickAskUseCase,
    private readonly defaultSaveTarget: SaveTarget,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('knowledge-maintenance-quick-ask');

    // 제목
    contentEl.createEl('h2', { text: 'Quick Ask' });

    // 질문 입력
    const inputContainer = contentEl.createDiv('quick-ask-input');
    this.questionInput = new TextAreaComponent(inputContainer);
    this.questionInput.setPlaceholder('질문을 입력하세요...');
    this.questionInput.inputEl.rows = 3;
    this.questionInput.inputEl.style.width = '100%';

    // 질문 버튼
    const buttonContainer = contentEl.createDiv('quick-ask-buttons');
    new ButtonComponent(buttonContainer)
      .setButtonText('질문하기')
      .setCta()
      .onClick(() => this.handleAsk());

    // 결과 영역
    this.resultContainer = contentEl.createDiv('quick-ask-result');
    this.resultContainer.style.display = 'none';
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async handleAsk(): Promise<void> {
    const question = this.questionInput?.getValue()?.trim();
    if (!question) {
      new Notice('질문을 입력해주세요.');
      return;
    }

    // 로딩 상태
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

      // 결과 렌더링
      this.renderResult(this.lastResult);
    } catch (err) {
      if (this.resultContainer) {
        this.resultContainer.innerHTML =
          `<p style="color: var(--text-error);">오류: ${err instanceof Error ? err.message : String(err)}</p>`;
      }
    }
  }

  private renderResult(result: QuickAskResult): void {
    if (!this.resultContainer) return;

    this.resultContainer.empty();

    // 응답 내용
    const answerEl = this.resultContainer.createDiv('quick-ask-answer');
    // MarkdownRenderer를 사용하여 마크다운 렌더링 (실제 구현 시)
    answerEl.innerHTML = `<h3>답변</h3><p>${result.answer}</p>`;

    // 메타 정보
    const metaEl = this.resultContainer.createDiv('quick-ask-meta');
    metaEl.createEl('small', {
      text: `저장 위치: ${result.savedTo} | 토큰: ${result.tokenUsage.totalTokens} | 비용: $${result.tokenUsage.estimatedCostUsd.toFixed(4)}`,
    });

    // 태그/링크 제안
    if (result.suggestedTags.length > 0) {
      metaEl.createEl('small', {
        text: ` | 태그: ${result.suggestedTags.join(', ')}`,
      });
    }
  }
}
