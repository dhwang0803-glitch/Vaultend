import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { RunMaintenanceUseCase } from '../application/usecases/RunMaintenanceUseCase';
import { ApplyMaintenanceActionUseCase } from '../application/usecases/ApplyMaintenanceActionUseCase';
import { MaintenancePlan, BrokenLink, MissingTagSuggestion, DuplicatePair, OrphanNoteEntry, EmptyNoteEntry } from '../domain/models/OrganizeModels';
import type { MaintenanceAction, MaintenanceIssueType } from '../domain/models/MaintenanceAction';
import { NotePath } from '../domain/values/NotePath';
import type { SeverityLevel } from '../domain/values/Severity';
import { ISSUE_SEVERITY, getSeverity } from '../domain/values/Severity';
import type { ConfigPort } from '../application/ports/ConfigPort';
import { MAINTENANCE_RESULT_VIEW_TYPE } from '../constants';
import { t, formatDate } from '../i18n';

export { MAINTENANCE_RESULT_VIEW_TYPE };

const ALL_ISSUE_TYPES: MaintenanceIssueType[] = [
  'broken-link', 'empty', 'orphan', 'duplicate', 'untagged', 'missing-tags',
];

interface BatchEntry {
  checkbox: HTMLInputElement;
  action: MaintenanceAction;
  setting: Setting;
  issueType: MaintenanceIssueType;
  identifier: string;
}

interface FilterState {
  issueTypes: Set<MaintenanceIssueType>;
  severityLevels: Set<SeverityLevel>;
  searchQuery: string;
}

export class MaintenanceResultView extends ItemView {
  private currentPlan: MaintenancePlan | null = null;
  private scanInProgress = false;
  private readonly dismissedIds = new Set<string>();
  private filterState: FilterState = {
    issueTypes: new Set(ALL_ISSUE_TYPES),
    severityLevels: new Set<SeverityLevel>(['critical', 'warning', 'info']),
    searchQuery: '',
  };

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
    return t('maintenance.viewTitle');
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
    contentEl.createEl('h4', { text: t('maintenance.title') });
    contentEl.createEl('p', { text: t('maintenance.scanning'), cls: 'maintenance-result-scanning' });

    try {
      this.currentPlan = await this.runMaintenance.execute();
      this.render();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl('h4', { text: t('maintenance.title') });
      contentEl.createEl('p', {
        text: t('maintenance.scanFailed', { error: err instanceof Error ? err.message : String(err) }),
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
    contentEl.createEl('h4', { text: t('maintenance.folderTitle', { folder: folderPath }) });
    contentEl.createEl('p', { text: t('maintenance.scanning'), cls: 'maintenance-result-scanning' });

    try {
      this.currentPlan = await this.runMaintenance.execute({ folder: folderPath });
      this.render();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl('h4', { text: t('maintenance.folderTitle', { folder: folderPath }) });
      contentEl.createEl('p', {
        text: t('maintenance.scanFailed', { error: err instanceof Error ? err.message : String(err) }),
        cls: 'maintenance-result-error',
      });
    } finally {
      this.scanInProgress = false;
    }
  }

  private renderEmpty(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h4', { text: t('maintenance.title') });

    new Setting(contentEl)
      .setName(t('maintenance.runScan'))
      .setDesc(t('maintenance.scanDesc'))
      .addButton(btn => btn
        .setButtonText(t('maintenance.startScan'))
        .setCta()
        .onClick(() => this.triggerScan()),
      );
  }

  private render(): void {
    const { contentEl } = this;
    const plan = this.currentPlan;
    if (!plan) return;

    contentEl.empty();
    contentEl.createEl('h4', { text: t('maintenance.title') });

    new Setting(contentEl)
      .setName(t('maintenance.rescan'))
      .setDesc(t('maintenance.lastScan', { time: formatDate(plan.timestamp as number) }))
      .addButton(btn => btn
        .setButtonText(t('maintenance.rescan'))
        .onClick(() => this.triggerScan()),
      );

    const counts = this.computeCounts(plan);
    const totalIssues = Object.values(counts).reduce((a, b) => a + b, 0);

    if (totalIssues === 0) {
      contentEl.createEl('p', {
        text: t('maintenance.vaultClean'),
        cls: 'maintenance-result-clean',
      });
      return;
    }

    // Summary
    const summaryEl = contentEl.createDiv('maintenance-result-summary');
    const parts: string[] = [];
    if (counts.empty > 0) parts.push(t('summary.emptyNotes', { count: counts.empty }));
    if (counts.untagged > 0) parts.push(t('summary.untagged', { count: counts.untagged }));
    if (counts['missing-tags'] > 0) parts.push(t('summary.missingTags', { count: counts['missing-tags'] }));
    if (counts['broken-link'] > 0) parts.push(t('summary.brokenLinks', { count: counts['broken-link'] }));
    if (counts.orphan > 0) parts.push(t('summary.orphanNotes', { count: counts.orphan }));
    if (counts.duplicate > 0) parts.push(t('summary.duplicates', { count: counts.duplicate }));
    summaryEl.createEl('p', { text: parts.join(' · ') });

    // Filter bar
    this.renderFilterBar(contentEl, counts);

    // Sections in severity order: critical → warning → info
    if (this.isTypeVisible('broken-link') && plan.brokenLinks.length > 0) {
      this.renderBrokenLinks(contentEl, plan.brokenLinks);
    }
    if (this.isTypeVisible('empty') && plan.emptyNotes.length > 0) {
      this.renderEmptyNotes(contentEl, plan.emptyNotes);
    }
    if (this.isTypeVisible('orphan') && plan.orphanNotes.length > 0) {
      this.renderOrphanNotes(contentEl, plan.orphanNotes);
    }
    if (this.isTypeVisible('duplicate') && plan.duplicateCandidates.length > 0) {
      this.renderDuplicates(contentEl, plan.duplicateCandidates);
    }
    if (this.isTypeVisible('untagged') && plan.untaggedNotes.length > 0) {
      this.renderUntaggedNotes(contentEl, plan.untaggedNotes);
    }
    if (this.isTypeVisible('missing-tags') && plan.missingTags.length > 0) {
      this.renderMissingTags(contentEl, plan.missingTags);
    }

    if (this.filterState.searchQuery) {
      const input = contentEl.querySelector('.maintenance-search-input') as HTMLInputElement | null;
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  }

  // ─── Filter ───

  private renderFilterBar(container: HTMLElement, counts: Record<MaintenanceIssueType, number>): void {
    const filterEl = container.createDiv('maintenance-filter-bar');

    // Severity chips
    const sevRow = filterEl.createDiv('filter-row');
    for (const sev of ['critical', 'warning', 'info'] as SeverityLevel[]) {
      const sevCount = ALL_ISSUE_TYPES
        .filter(type => getSeverity(type) === sev)
        .reduce((sum, type) => sum + counts[type], 0);
      if (sevCount === 0) continue;

      const isActive = this.filterState.severityLevels.has(sev);
      const chip = sevRow.createEl('button', { cls: 'filter-chip' });
      if (isActive) chip.addClass('active');
      chip.setAttribute('aria-pressed', String(isActive));
      chip.addClass(`filter-chip-${sev}`);

      const badge = chip.createSpan({ cls: `maintenance-severity-badge severity-${sev}` });
      badge.textContent = t(`severity.${sev}` as const);
      chip.createSpan({ text: ` ${sevCount}`, cls: 'chip-count' });

      chip.addEventListener('click', () => {
        if (this.filterState.severityLevels.has(sev)) {
          this.filterState.severityLevels.delete(sev);
        } else {
          this.filterState.severityLevels.add(sev);
        }
        this.render();
      });
    }

    // Type chips
    const typeRow = filterEl.createDiv('filter-row');
    for (const type of ALL_ISSUE_TYPES) {
      if (counts[type] === 0) continue;

      const isActive = this.filterState.issueTypes.has(type);
      const chip = typeRow.createEl('button', { cls: 'filter-chip' });
      if (isActive) chip.addClass('active');
      chip.setAttribute('aria-pressed', String(isActive));

      chip.createSpan({ text: t(`issueShort.${type}` as const) });
      chip.createSpan({ text: ` ${counts[type]}`, cls: 'chip-count' });

      chip.addEventListener('click', () => {
        if (this.filterState.issueTypes.has(type)) {
          this.filterState.issueTypes.delete(type);
        } else {
          this.filterState.issueTypes.add(type);
        }
        this.render();
      });
    }

    // Text search
    const searchRow = filterEl.createDiv('filter-row');
    const searchInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: t('filter.searchPlaceholder'),
      cls: 'maintenance-search-input',
    });
    searchInput.value = this.filterState.searchQuery;
    searchInput.addEventListener('input', () => {
      this.filterState.searchQuery = searchInput.value;
      this.render();
    });
  }

  private isTypeVisible(type: MaintenanceIssueType): boolean {
    return this.filterState.issueTypes.has(type)
      && this.filterState.severityLevels.has(ISSUE_SEVERITY[type]);
  }

  private matchesSearch(path: string): boolean {
    if (!this.filterState.searchQuery) return true;
    return path.toLowerCase().includes(this.filterState.searchQuery.toLowerCase());
  }

  private computeCounts(plan: MaintenancePlan): Record<MaintenanceIssueType, number> {
    return {
      empty: plan.emptyNotes.filter(i => !this.dismissedIds.has(`empty:${i.notePath as string}`)).length,
      untagged: plan.untaggedNotes.filter(p => !this.dismissedIds.has(`untagged:${p as string}`)).length,
      'missing-tags': plan.missingTags.filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath as string}`)).length,
      'broken-link': plan.brokenLinks.filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath as string}:${i.lineNumber}:${i.targetLink}`)).length,
      orphan: plan.orphanNotes.filter(e => !this.dismissedIds.has(`orphan:${e.notePath as string}`)).length,
      duplicate: plan.duplicateCandidates.filter(p => !this.dismissedIds.has(`duplicate:${p.noteA as string}|${p.noteB as string}`)).length,
    };
  }

  // ─── Section Headings with Severity Badge ───

  private renderSectionHeading(container: HTMLElement, issueType: MaintenanceIssueType, label: string): void {
    const heading = container.createEl('h5', { cls: 'maintenance-section-heading' });
    const severity = getSeverity(issueType);
    const badge = heading.createSpan({ cls: `maintenance-severity-badge severity-${severity}` });
    badge.textContent = t(`severity.${severity}` as const);
    heading.appendText(` ${label}`);
  }

  // ─── Section Renderers ───

  private renderEmptyNotes(container: HTMLElement, items: ReadonlyArray<EmptyNoteEntry>): void {
    const filtered = items
      .filter(i => !this.dismissedIds.has(`empty:${i.notePath as string}`))
      .filter(i => this.matchesSearch(i.notePath as string));
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'empty', t('issue.emptyNotes', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, t('batch.selectedArchive'));

    for (const item of filtered) {
      const settingEl = new Setting(container)
        .setName(this.basename(item.notePath))
        .setDesc(item.notePath as string);

      if (item.backlinkCount > 0) {
        const warningEl = settingEl.settingEl.createDiv('maintenance-impact-warning');
        const backlinkNames = item.backlinkPaths.slice(0, 3).map(p => this.basename(p)).join(', ');
        const suffix = item.backlinkCount > 3
          ? t('impact.andMore', { count: item.backlinkCount - 3 })
          : '';
        warningEl.textContent = t('impact.warning', {
          count: item.backlinkCount,
          names: backlinkNames,
          suffix,
        });
      }

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'archive-note', notePath: item.notePath, targetFolder: '' },
        setting: settingEl,
        issueType: 'empty',
        identifier: item.notePath as string,
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(item.notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.archive'))
        .setCta()
        .onClick(() => this.archiveWithConfig(item.notePath, settingEl)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.delete'))
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
    const filtered = items
      .filter(p => !this.dismissedIds.has(`untagged:${p as string}`))
      .filter(p => this.matchesSearch(p as string));
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'untagged', t('issue.untaggedNotes', { count: filtered.length }));

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
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(notePath as string)),
      );

      this.addDismissButton(settingEl, 'untagged', notePath as string);
    }
  }

  private renderMissingTags(container: HTMLElement, items: ReadonlyArray<MissingTagSuggestion>): void {
    const filtered = items
      .filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath as string}`))
      .filter(i => this.matchesSearch(i.notePath as string));
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'missing-tags', t('issue.missingTags', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, t('batch.selectedApplyTags'));

    for (const item of filtered) {
      const settingEl = new Setting(container)
        .setName(this.basename(item.notePath))
        .setDesc(t('duplicate.tagSuggestion', { tags: item.suggestedTags.join(', ') }));

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'apply-missing-tags', notePath: item.notePath, tags: item.suggestedTags },
        setting: settingEl,
        issueType: 'missing-tags',
        identifier: item.notePath as string,
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.applyTags'))
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
    const filtered = items
      .filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath as string}:${i.lineNumber}:${i.targetLink}`))
      .filter(i => this.matchesSearch(i.sourcePath as string));
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'broken-link', t('issue.brokenLinks', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, t('batch.selectedRemoveLinks'));

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
        .setButtonText(t('btn.removeLink'))
        .onClick(() => this.executeAction(
          { kind: 'remove-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, lineNumber: item.lineNumber },
          settingEl,
        )),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.createNote'))
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
      .filter(e => this.matchesSearch(e.notePath as string))
      .slice()
      .sort((a, b) => b.fileSize - a.fileSize);
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'orphan', t('issue.orphanNotes', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, t('batch.selectedDelete'), true);

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
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(entry.notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.archive'))
        .onClick(() => this.archiveWithConfig(entry.notePath, settingEl)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.delete'))
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
    const filtered = items
      .filter(p => !this.dismissedIds.has(`duplicate:${p.noteA as string}|${p.noteB as string}`))
      .filter(p => this.matchesSearch(p.noteA as string) || this.matchesSearch(p.noteB as string));
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'duplicate', t('issue.duplicates', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries);

    for (const pair of filtered) {
      const score = Math.round(pair.similarityScore * 100);
      const settingEl = new Setting(container)
        .setName(`${this.basename(pair.noteA)} ↔ ${this.basename(pair.noteB)}`)
        .setDesc(t('duplicate.similarity', { score }));

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'dismiss', issueType: 'duplicate', identifier: `${pair.noteA as string}|${pair.noteB as string}` },
        setting: settingEl,
        issueType: 'duplicate',
        identifier: `${pair.noteA as string}|${pair.noteB as string}`,
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.openSideBySide'))
        .onClick(() => this.openFileSplit(pair.noteA as string, pair.noteB as string)),
      );

      this.addDismissButton(settingEl, 'duplicate', `${pair.noteA as string}|${pair.noteB as string}`);
    }
  }

  // ─── Batch & Actions ───

  private renderBatchControls(
    container: HTMLElement,
    entries: BatchEntry[],
    primaryLabel?: string,
    primaryWarning = false,
  ): void {
    const batchSetting = new Setting(container)
      .setClass('maintenance-batch-controls')
      .setName(t('batch.selectAll'));

    batchSetting.addToggle(toggle => toggle
      .setTooltip(t('batch.toggleAll'))
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
      .setButtonText(t('batch.selectedDismiss'))
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
      .setTooltip(t('dismiss.tooltip'))
      .onClick(async () => {
        await this.applyAction.execute({
          kind: 'dismiss',
          issueType: issueType as MaintenanceIssueType,
          identifier,
        });
        this.dismissedIds.add(`${issueType}:${identifier}`);
        setting.settingEl.remove();
        new Notice(t('notice.dismissed'));
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
      setting.setDesc(t('maintenance.applied'));
      new Notice(t('notice.actionApplied'));
    } catch (err) {
      new Notice(t('notice.actionFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private async executeBatch(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked);
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
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
        entry.setting.setDesc(t('maintenance.applied'));
        applied.add(entry);
        success++;
      } catch {
        failed++;
      }
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (applied.has(entries[i])) entries.splice(i, 1);
    }
    const msg = failed > 0
      ? t('notice.batchResult', { success, failed })
      : t('notice.batchComplete', { count: success });
    new Notice(msg);
  }

  private async dismissBatch(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked);
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }
    let success = 0;
    let failed = 0;
    const dismissed = new Set<BatchEntry>();
    for (const entry of selected) {
      try {
        await this.applyAction.execute({
          kind: 'dismiss',
          issueType: entry.issueType,
          identifier: entry.identifier,
        });
        this.dismissedIds.add(`${entry.issueType}:${entry.identifier}`);
        entry.setting.settingEl.remove();
        dismissed.add(entry);
        success++;
      } catch {
        failed++;
      }
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (dismissed.has(entries[i])) entries.splice(i, 1);
    }
    const msg = failed > 0
      ? t('notice.batchResult', { success, failed })
      : t('notice.batchDismissed', { count: success });
    new Notice(msg);
  }

  private async getArchiveFolder(): Promise<string> {
    const settings = await this.configPort.getSettings();
    return settings.maintenanceArchiveFolder;
  }

  // ─── Utilities ───

  private basename(path: NotePath): string {
    return (path as string).split('/').pop()?.replace('.md', '') ?? (path as string);
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
