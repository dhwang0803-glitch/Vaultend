import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { RunMaintenanceUseCase } from '../application/usecases/RunMaintenanceUseCase';
import { ApplyMaintenanceActionUseCase } from '../application/usecases/ApplyMaintenanceActionUseCase';
import { MaintenancePlan, BrokenLink, MissingTagSuggestion, DuplicatePair } from '../domain/models/OrganizeModels';
import type { MaintenanceAction, MaintenanceIssueType } from '../domain/models/MaintenanceAction';
import { NotePath } from '../domain/values/NotePath';
import { MAINTENANCE_RESULT_VIEW_TYPE } from '../constants';

export { MAINTENANCE_RESULT_VIEW_TYPE };

export class MaintenanceResultView extends ItemView {
  private currentPlan: MaintenancePlan | null = null;
  private scanInProgress = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly runMaintenance: RunMaintenanceUseCase,
    private readonly applyAction: ApplyMaintenanceActionUseCase,
    private readonly openFile: (path: string) => void,
    private readonly openFileSplit: (pathA: string, pathB: string) => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return MAINTENANCE_RESULT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Vault 유지보수';
  }

  getIcon(): string {
    return 'shield-check';
  }

  async onOpen(): Promise<void> {
    this.renderEmpty();
  }

  async triggerScan(): Promise<void> {
    if (this.scanInProgress) return;
    this.scanInProgress = true;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h4', { text: 'Vault 유지보수 결과' });
    contentEl.createEl('p', { text: '스캔 중...', cls: 'maintenance-result-scanning' });

    try {
      this.currentPlan = await this.runMaintenance.execute();
      this.render();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl('h4', { text: 'Vault 유지보수 결과' });
      contentEl.createEl('p', {
        text: `스캔 실패: ${err instanceof Error ? err.message : String(err)}`,
        cls: 'maintenance-result-error',
      });
    } finally {
      this.scanInProgress = false;
    }
  }

  private renderEmpty(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h4', { text: 'Vault 유지보수 결과' });

    new Setting(contentEl)
      .setName('스캔 실행')
      .setDesc('Vault 전체를 분석합니다')
      .addButton(btn => btn
        .setButtonText('스캔 시작')
        .setCta()
        .onClick(() => this.triggerScan()),
      );
  }

  private render(): void {
    const { contentEl } = this;
    const plan = this.currentPlan;
    if (!plan) return;

    contentEl.empty();
    contentEl.createEl('h4', { text: 'Vault 유지보수 결과' });

    new Setting(contentEl)
      .setName('다시 스캔')
      .setDesc(this.formatTimestamp(plan.timestamp as number))
      .addButton(btn => btn
        .setButtonText('다시 스캔')
        .onClick(() => this.triggerScan()),
      );

    const totalIssues = plan.missingTags.length + plan.brokenLinks.length
      + plan.orphanNotes.length + plan.duplicateCandidates.length;

    if (totalIssues === 0) {
      contentEl.createEl('p', {
        text: 'Vault 상태가 양호합니다.',
        cls: 'maintenance-result-clean',
      });
      return;
    }

    const summaryEl = contentEl.createDiv('maintenance-result-summary');
    const parts: string[] = [];
    if (plan.missingTags.length > 0) parts.push(`누락 태그 ${plan.missingTags.length}`);
    if (plan.brokenLinks.length > 0) parts.push(`깨진 링크 ${plan.brokenLinks.length}`);
    if (plan.orphanNotes.length > 0) parts.push(`고아 노트 ${plan.orphanNotes.length}`);
    if (plan.duplicateCandidates.length > 0) parts.push(`중복 후보 ${plan.duplicateCandidates.length}`);
    summaryEl.createEl('p', { text: parts.join(' · ') });

    if (plan.missingTags.length > 0) {
      this.renderMissingTags(contentEl, plan.missingTags);
    }
    if (plan.brokenLinks.length > 0) {
      this.renderBrokenLinks(contentEl, plan.brokenLinks);
    }
    if (plan.orphanNotes.length > 0) {
      this.renderOrphanNotes(contentEl, plan.orphanNotes);
    }
    if (plan.duplicateCandidates.length > 0) {
      this.renderDuplicates(contentEl, plan.duplicateCandidates);
    }
  }

  private renderMissingTags(container: HTMLElement, items: ReadonlyArray<MissingTagSuggestion>): void {
    container.createEl('h5', { text: `누락 태그 (${items.length})` });

    for (const item of items) {
      const settingEl = new Setting(container)
        .setName(this.basename(item.notePath))
        .setDesc(`${item.suggestedTags.join(', ')} 추가 제안`);

      settingEl.addButton(btn => btn
        .setButtonText('태그 적용')
        .setCta()
        .onClick(() => this.executeAction(
          { kind: 'apply-missing-tags', notePath: item.notePath, tags: item.suggestedTags },
          settingEl,
        )),
      );

      this.addDismissButton(settingEl, 'missing-tags', item.notePath as string);
    }
  }

  private renderBrokenLinks(container: HTMLElement, items: ReadonlyArray<BrokenLink>): void {
    container.createEl('h5', { text: `깨진 링크 (${items.length})` });

    for (const item of items) {
      const settingEl = new Setting(container)
        .setName(`${this.basename(item.sourcePath)}:${item.lineNumber}`)
        .setDesc(`[[${item.targetLink}]]`);

      settingEl.addButton(btn => btn
        .setButtonText('링크 제거')
        .onClick(() => this.executeAction(
          { kind: 'remove-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, lineNumber: item.lineNumber },
          settingEl,
        )),
      );

      settingEl.addButton(btn => btn
        .setButtonText('노트 생성')
        .onClick(() => this.executeAction(
          { kind: 'create-missing-note', targetLink: item.targetLink },
          settingEl,
        )),
      );

      this.addDismissButton(settingEl, 'broken-link', `${item.sourcePath as string}:${item.lineNumber}:${item.targetLink}`);
    }
  }

  private renderOrphanNotes(container: HTMLElement, items: ReadonlyArray<NotePath>): void {
    container.createEl('h5', { text: `고아 노트 (${items.length})` });

    for (const notePath of items) {
      const settingEl = new Setting(container)
        .setName(this.basename(notePath))
        .setDesc(notePath as string);

      settingEl.addButton(btn => btn
        .setButtonText('열기')
        .onClick(() => this.openFile(notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText('삭제')
        .setWarning()
        .onClick(() => this.executeAction(
          { kind: 'delete-orphan', notePath },
          settingEl,
        )),
      );

      this.addDismissButton(settingEl, 'orphan', notePath as string);
    }
  }

  private renderDuplicates(container: HTMLElement, items: ReadonlyArray<DuplicatePair>): void {
    container.createEl('h5', { text: `중복 후보 (${items.length})` });

    for (const pair of items) {
      const score = Math.round(pair.similarityScore * 100);
      const settingEl = new Setting(container)
        .setName(`${this.basename(pair.noteA)} ↔ ${this.basename(pair.noteB)}`)
        .setDesc(`유사도 ${score}%`);

      settingEl.addButton(btn => btn
        .setButtonText('나란히 열기')
        .onClick(() => this.openFileSplit(pair.noteA as string, pair.noteB as string)),
      );

      this.addDismissButton(settingEl, 'duplicate', `${pair.noteA as string}|${pair.noteB as string}`);
    }
  }

  private addDismissButton(setting: Setting, issueType: string, identifier: string): void {
    setting.addExtraButton(btn => btn
      .setIcon('x')
      .setTooltip('무시')
      .onClick(async () => {
        await this.applyAction.execute({
          kind: 'dismiss',
          issueType: issueType as MaintenanceIssueType,
          identifier,
        });
        setting.settingEl.remove();
        new Notice('이슈를 무시했습니다');
      }),
    );
  }

  private async executeAction(action: MaintenanceAction, setting: Setting): Promise<void> {
    try {
      await this.applyAction.execute(action);
      setting.settingEl.addClass('maintenance-result-applied');
      setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
      setting.setDesc('적용됨');
      new Notice('액션을 적용했습니다');
    } catch (err) {
      new Notice(`적용 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private basename(path: NotePath): string {
    return (path as string).split('/').pop()?.replace('.md', '') ?? (path as string);
  }

  private formatTimestamp(ts: number): string {
    return `마지막 스캔: ${new Date(ts).toLocaleString('ko-KR')}`;
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
