import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { RunMaintenanceUseCase } from '../application/usecases/RunMaintenanceUseCase';
import { ApplyMaintenanceActionUseCase } from '../application/usecases/ApplyMaintenanceActionUseCase';
import { MaintenancePlan, BrokenLink, MissingTagSuggestion, DuplicatePair, OrphanNoteEntry, EmptyNoteEntry } from '../domain/models/OrganizeModels';
import type { MaintenanceAction, MaintenanceIssueType } from '../domain/models/MaintenanceAction';
import { NotePath } from '../domain/values/NotePath';
import type { ConfigPort } from '../application/ports/ConfigPort';
import { MAINTENANCE_RESULT_VIEW_TYPE } from '../constants';

export { MAINTENANCE_RESULT_VIEW_TYPE };

interface BatchEntry {
  checkbox: HTMLInputElement;
  action: MaintenanceAction;
  setting: Setting;
  issueType: MaintenanceIssueType;
  identifier: string;
}

export class MaintenanceResultView extends ItemView {
  private currentPlan: MaintenancePlan | null = null;
  private scanInProgress = false;
  private readonly dismissedIds = new Set<string>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly runMaintenance: RunMaintenanceUseCase,
    private readonly applyAction: ApplyMaintenanceActionUseCase,
    private readonly configPort: ConfigPort,
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

  async triggerScanForFolder(folderPath: string): Promise<void> {
    if (this.scanInProgress) return;
    this.scanInProgress = true;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h4', { text: `유지보수 결과: ${folderPath}/` });
    contentEl.createEl('p', { text: '스캔 중...', cls: 'maintenance-result-scanning' });

    try {
      this.currentPlan = await this.runMaintenance.execute({ folder: folderPath });
      this.render();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl('h4', { text: `유지보수 결과: ${folderPath}/` });
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

    const emptyCount = plan.emptyNotes.filter(i => !this.dismissedIds.has(`empty:${i.notePath as string}`)).length;
    const untaggedCount = plan.untaggedNotes.filter(p => !this.dismissedIds.has(`untagged:${p as string}`)).length;
    const missingTagsCount = plan.missingTags.filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath as string}`)).length;
    const brokenLinksCount = plan.brokenLinks.filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath as string}:${i.lineNumber}:${i.targetLink}`)).length;
    const orphanCount = plan.orphanNotes.filter(e => !this.dismissedIds.has(`orphan:${e.notePath as string}`)).length;
    const dupCount = plan.duplicateCandidates.filter(p => !this.dismissedIds.has(`duplicate:${p.noteA as string}|${p.noteB as string}`)).length;
    const totalIssues = emptyCount + untaggedCount + missingTagsCount + brokenLinksCount + orphanCount + dupCount;

    if (totalIssues === 0) {
      contentEl.createEl('p', {
        text: 'Vault 상태가 양호합니다.',
        cls: 'maintenance-result-clean',
      });
      return;
    }

    const summaryEl = contentEl.createDiv('maintenance-result-summary');
    const parts: string[] = [];
    if (emptyCount > 0) parts.push(`빈 노트 ${emptyCount}`);
    if (untaggedCount > 0) parts.push(`미태그 ${untaggedCount}`);
    if (missingTagsCount > 0) parts.push(`누락 태그 ${missingTagsCount}`);
    if (brokenLinksCount > 0) parts.push(`깨진 링크 ${brokenLinksCount}`);
    if (orphanCount > 0) parts.push(`고아 노트 ${orphanCount}`);
    if (dupCount > 0) parts.push(`중복 후보 ${dupCount}`);
    summaryEl.createEl('p', { text: parts.join(' · ') });

    if (plan.emptyNotes.length > 0) {
      this.renderEmptyNotes(contentEl, plan.emptyNotes);
    }
    if (plan.untaggedNotes.length > 0) {
      this.renderUntaggedNotes(contentEl, plan.untaggedNotes);
    }
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

  private renderEmptyNotes(container: HTMLElement, items: ReadonlyArray<EmptyNoteEntry>): void {
    const filtered = items.filter(i => !this.dismissedIds.has(`empty:${i.notePath as string}`));
    if (filtered.length === 0) return;
    container.createEl('h5', { text: `빈 노트 (${filtered.length})` });

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, '선택 아카이브');

    for (const item of filtered) {
      const settingEl = new Setting(container)
        .setName(this.basename(item.notePath))
        .setDesc(item.notePath as string);

      if (item.backlinkCount > 0) {
        const warningEl = settingEl.settingEl.createDiv('maintenance-impact-warning');
        const backlinkNames = item.backlinkPaths.slice(0, 3).map(p => this.basename(p)).join(', ');
        const suffix = item.backlinkCount > 3 ? ` 외 ${item.backlinkCount - 3}개` : '';
        warningEl.textContent = `⚠ 이 노트를 참조하는 ${item.backlinkCount}개 노트: ${backlinkNames}${suffix}`;
      }

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'archive-note', notePath: item.notePath, targetFolder: '' },
        setting: settingEl,
        issueType: 'empty',
        identifier: item.notePath as string,
      });

      settingEl.addButton(btn => btn
        .setButtonText('열기')
        .onClick(() => this.openFile(item.notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText('아카이브')
        .setCta()
        .onClick(() => this.archiveWithConfig(item.notePath, settingEl)),
      );

      settingEl.addButton(btn => btn
        .setButtonText('삭제')
        .setWarning()
        .onClick(() => this.executeAction(
          { kind: 'delete-orphan', notePath: item.notePath },
          settingEl,
        )),
      );

      this.addDismissButton(settingEl, 'empty', item.notePath as string);
    }
  }

  private renderUntaggedNotes(container: HTMLElement, items: ReadonlyArray<NotePath>): void {
    const filtered = items.filter(p => !this.dismissedIds.has(`untagged:${p as string}`));
    if (filtered.length === 0) return;
    container.createEl('h5', { text: `미태그 노트 (${filtered.length})` });

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries);

    for (const notePath of filtered) {
      const settingEl = new Setting(container)
        .setName(this.basename(notePath))
        .setDesc(notePath as string);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'dismiss', issueType: 'untagged', identifier: notePath as string },
        setting: settingEl,
        issueType: 'untagged',
        identifier: notePath as string,
      });

      settingEl.addButton(btn => btn
        .setButtonText('열기')
        .onClick(() => this.openFile(notePath as string)),
      );

      this.addDismissButton(settingEl, 'untagged', notePath as string);
    }
  }

  private renderMissingTags(container: HTMLElement, items: ReadonlyArray<MissingTagSuggestion>): void {
    const filtered = items.filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath as string}`));
    if (filtered.length === 0) return;
    container.createEl('h5', { text: `누락 태그 (${filtered.length})` });

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, '선택 태그 적용');

    for (const item of filtered) {
      const settingEl = new Setting(container)
        .setName(this.basename(item.notePath))
        .setDesc(`${item.suggestedTags.join(', ')} 추가 제안`);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'apply-missing-tags', notePath: item.notePath, tags: item.suggestedTags },
        setting: settingEl,
        issueType: 'missing-tags',
        identifier: item.notePath as string,
      });

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
    const filtered = items.filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath as string}:${i.lineNumber}:${i.targetLink}`));
    if (filtered.length === 0) return;
    container.createEl('h5', { text: `깨진 링크 (${filtered.length})` });

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, '선택 링크 제거');

    for (const item of filtered) {
      const settingEl = new Setting(container)
        .setName(`${this.basename(item.sourcePath)}:${item.lineNumber}`)
        .setDesc(`[[${item.targetLink}]]`);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'remove-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, lineNumber: item.lineNumber },
        setting: settingEl,
        issueType: 'broken-link',
        identifier: `${item.sourcePath as string}:${item.lineNumber}:${item.targetLink}`,
      });

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

  private renderOrphanNotes(container: HTMLElement, items: ReadonlyArray<OrphanNoteEntry>): void {
    const filtered = items
      .filter(e => !this.dismissedIds.has(`orphan:${e.notePath as string}`))
      .slice()
      .sort((a, b) => b.fileSize - a.fileSize);
    if (filtered.length === 0) return;
    container.createEl('h5', { text: `고아 노트 (${filtered.length})` });

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, '선택 삭제', true);

    for (const entry of filtered) {
      const sizeStr = this.formatFileSize(entry.fileSize);
      const settingEl = new Setting(container)
        .setName(this.basename(entry.notePath))
        .setDesc(`${entry.notePath as string} · ${sizeStr}`);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'delete-orphan', notePath: entry.notePath },
        setting: settingEl,
        issueType: 'orphan',
        identifier: entry.notePath as string,
      });

      settingEl.addButton(btn => btn
        .setButtonText('열기')
        .onClick(() => this.openFile(entry.notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText('아카이브')
        .onClick(() => this.archiveWithConfig(entry.notePath, settingEl)),
      );

      settingEl.addButton(btn => btn
        .setButtonText('삭제')
        .setWarning()
        .onClick(() => this.executeAction(
          { kind: 'delete-orphan', notePath: entry.notePath },
          settingEl,
        )),
      );

      this.addDismissButton(settingEl, 'orphan', entry.notePath as string);
    }
  }

  private renderDuplicates(container: HTMLElement, items: ReadonlyArray<DuplicatePair>): void {
    const filtered = items.filter(p => !this.dismissedIds.has(`duplicate:${p.noteA as string}|${p.noteB as string}`));
    if (filtered.length === 0) return;
    container.createEl('h5', { text: `중복 후보 (${filtered.length})` });

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries);

    for (const pair of filtered) {
      const score = Math.round(pair.similarityScore * 100);
      const settingEl = new Setting(container)
        .setName(`${this.basename(pair.noteA)} ↔ ${this.basename(pair.noteB)}`)
        .setDesc(`유사도 ${score}%`);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'dismiss', issueType: 'duplicate', identifier: `${pair.noteA as string}|${pair.noteB as string}` },
        setting: settingEl,
        issueType: 'duplicate',
        identifier: `${pair.noteA as string}|${pair.noteB as string}`,
      });

      settingEl.addButton(btn => btn
        .setButtonText('나란히 열기')
        .onClick(() => this.openFileSplit(pair.noteA as string, pair.noteB as string)),
      );

      this.addDismissButton(settingEl, 'duplicate', `${pair.noteA as string}|${pair.noteB as string}`);
    }
  }

  private renderBatchControls(
    container: HTMLElement,
    entries: BatchEntry[],
    primaryLabel?: string,
    primaryWarning = false,
  ): void {
    const batchSetting = new Setting(container)
      .setClass('maintenance-batch-controls')
      .setName('전체 선택');

    batchSetting.addToggle(toggle => toggle
      .setTooltip('전체 선택 / 해제')
      .onChange(checked => entries.forEach(e => { e.checkbox.checked = checked; })),
    );

    if (primaryLabel) {
      batchSetting.addButton(btn => {
        btn.setButtonText(primaryLabel)
          .onClick(() => this.executeBatch(entries));
        if (primaryWarning) btn.setWarning();
      });
    }

    batchSetting.addButton(btn => btn
      .setButtonText('선택 무시')
      .onClick(() => this.dismissBatch(entries)),
    );
  }

  private prependCheckbox(setting: Setting): HTMLInputElement {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'maintenance-batch-checkbox';
    setting.settingEl.prepend(checkbox);
    return checkbox;
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
        this.dismissedIds.add(`${issueType}:${identifier}`);
        setting.settingEl.remove();
        new Notice('이슈를 무시했습니다');
      }),
    );
  }

  private async archiveWithConfig(notePath: NotePath, setting: Setting): Promise<void> {
    const settings = await this.configPort.getSettings();
    await this.executeAction(
      { kind: 'archive-note', notePath, targetFolder: settings.maintenanceArchiveFolder },
      setting,
    );
  }

  private async executeAction(action: MaintenanceAction, setting: Setting): Promise<void> {
    try {
      await this.applyAction.execute(action);
      setting.settingEl.addClass('maintenance-result-applied');
      setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
      const cb = setting.settingEl.querySelector('.maintenance-batch-checkbox');
      if (cb) cb.remove();
      setting.setDesc('적용됨');
      new Notice('액션을 적용했습니다');
    } catch (err) {
      new Notice(`적용 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async executeBatch(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked);
    if (selected.length === 0) {
      new Notice('선택된 항목이 없습니다');
      return;
    }

    const archiveFolder = await this.getArchiveFolder();
    let success = 0;
    let failed = 0;
    const applied = new Set<BatchEntry>();
    for (const entry of selected) {
      try {
        let action = entry.action;
        if (action.kind === 'archive-note' && !action.targetFolder) {
          action = { ...action, targetFolder: archiveFolder };
        }
        await this.applyAction.execute(action);
        entry.setting.settingEl.addClass('maintenance-result-applied');
        entry.setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
        entry.checkbox.remove();
        entry.setting.setDesc('적용됨');
        applied.add(entry);
        success++;
      } catch {
        failed++;
      }
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (applied.has(entries[i])) entries.splice(i, 1);
    }
    const msg = failed > 0 ? `${success}건 적용, ${failed}건 실패` : `${success}건 적용 완료`;
    new Notice(msg);
  }

  private async dismissBatch(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked);
    if (selected.length === 0) {
      new Notice('선택된 항목이 없습니다');
      return;
    }
    for (const entry of selected) {
      await this.applyAction.execute({
        kind: 'dismiss',
        issueType: entry.issueType,
        identifier: entry.identifier,
      });
      this.dismissedIds.add(`${entry.issueType}:${entry.identifier}`);
      entry.setting.settingEl.remove();
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (selected.includes(entries[i])) entries.splice(i, 1);
    }
    new Notice(`${selected.length}건 무시 처리`);
  }

  private async getArchiveFolder(): Promise<string> {
    const settings = await this.configPort.getSettings();
    return settings.maintenanceArchiveFolder;
  }

  private basename(path: NotePath): string {
    return (path as string).split('/').pop()?.replace('.md', '') ?? (path as string);
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private formatTimestamp(ts: number): string {
    return `마지막 스캔: ${new Date(ts).toLocaleString('ko-KR')}`;
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
