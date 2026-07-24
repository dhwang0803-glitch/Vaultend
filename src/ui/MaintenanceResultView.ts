import { ItemView, Notice, setIcon, Setting, WorkspaceLeaf } from 'obsidian';
import { RunMaintenanceUseCase } from '../application/usecases/RunMaintenanceUseCase';
import { ApplyMaintenanceActionUseCase, type ApplyResult } from '../application/usecases/ApplyMaintenanceActionUseCase';
import { MaintenancePlan, BrokenLink, MissingTagSuggestion, DuplicatePair, OrphanNoteEntry, EmptyNoteEntry, DuplicateTagGroup } from '../domain/models/OrganizeModels';
import type { MaintenanceAction, MaintenanceIssueType, FixBrokenLink } from '../domain/models/MaintenanceAction';
import { NotePath, createNotePath } from '../domain/values/NotePath';
import type { SeverityLevel } from '../domain/values/Severity';
import { ISSUE_SEVERITY, getSeverity } from '../domain/values/Severity';
import type { ConfigPort } from '../application/ports/ConfigPort';
import type { HistoryPort } from '../application/ports/HistoryPort';
import { localizeError } from './localizeError';
import { MAINTENANCE_RESULT_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
import type { OrganizeResult } from '../domain/models/OrganizeModels';
import { OrganizeBatchPreviewModal, type BatchPreviewItem, type BatchAppliedEntry, type BatchOrganizeCallbacks } from './OrganizeBatchPreviewModal';
import { t, formatDate } from '../i18n';

export { MAINTENANCE_RESULT_VIEW_TYPE };

const ALL_ISSUE_TYPES: MaintenanceIssueType[] = [
  'broken-link', 'empty', 'orphan', 'duplicate', 'duplicate-tags', 'untagged', 'missing-tags',
];

interface BatchEntry {
  checkbox: HTMLInputElement;
  action: MaintenanceAction;
  setting: Setting;
  issueType: MaintenanceIssueType;
  identifier: string;
  historyEntryId?: string;
  status: 'pending' | 'applied' | 'restored';
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
  private readonly appliedEntries = new Map<string, string>();
  private restoreInProgress = false;
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
    private readonly historyPort: HistoryPort,
    private readonly openFile: (path: string) => void,
    private readonly openFileSplit: (pathA: string, pathB: string) => void,
    private readonly onMergeRequest: (pair: DuplicatePair) => void,
    private readonly onOrganizePreview?: (notePaths: NotePath[], onProgress?: (current: number, total: number) => void) => Promise<Array<{ notePath: NotePath; result: OrganizeResult }>>,
    private readonly onOrganizeTagsOnly?: (notePaths: NotePath[], onProgress?: (current: number, total: number) => void) => Promise<Array<{ notePath: NotePath; result: OrganizeResult }>>,
    private readonly batchOrganizeCallbacks?: BatchOrganizeCallbacks,
    private readonly onClearOrganizeCache?: () => void,
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
    this.registerEvent(
      this.app.workspace.on(HISTORY_CHANGED_EVENT, (undoneId?: string) =>
        this.onHistoryChanged(undoneId)),
    );
    this.renderEmpty();
  }

  private onHistoryChanged(undoneId?: string): void {
    if (!undoneId || !this.currentPlan) return;
    for (const [key, id] of this.appliedEntries) {
      if (id === undoneId) {
        this.appliedEntries.delete(key);
        this.render();
        return;
      }
    }
  }

  refreshLocale(): void {
    if (this.currentPlan) {
      this.render();
    } else {
      this.renderEmpty();
    }
  }

  isScanInProgress(): boolean {
    return this.scanInProgress;
  }

  isRestoreInProgress(): boolean {
    return this.restoreInProgress;
  }

  showPlan(plan: MaintenancePlan): void {
    if (this.restoreInProgress) return;
    this.currentPlan = plan;
    this.appliedEntries.clear();
    this.render();
  }

  async triggerScan(): Promise<void> {
    if (this.scanInProgress) return;
    this.scanInProgress = true;
    this.onClearOrganizeCache?.();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h4', { text: t('maintenance.title') });
    contentEl.createEl('p', { text: t('maintenance.scanning'), cls: 'maintenance-result-scanning' });

    try {
      this.currentPlan = await this.runMaintenance.execute();
      this.appliedEntries.clear();
      this.render();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl('h4', { text: t('maintenance.title') });
      contentEl.createEl('p', {
        text: t('maintenance.scanFailed', { error: localizeError(err) }),
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
      this.appliedEntries.clear();
      this.render();
    } catch (err) {
      contentEl.empty();
      contentEl.createEl('h4', { text: t('maintenance.folderTitle', { folder: folderPath }) });
      contentEl.createEl('p', {
        text: t('maintenance.scanFailed', { error: localizeError(err) }),
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
        .onClick(() => { void this.triggerScan(); }),
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
      .setDesc(t('maintenance.lastScan', { time: formatDate(plan.timestamp) }))
      .addButton(btn => btn
        .setButtonText(t('maintenance.rescan'))
        .onClick(() => { void this.triggerScan(); }),
      );

    const counts = this.computeCounts(plan);
    const totalIssues = Object.values(counts).reduce((a, b) => a + b, 0);

    if (totalIssues === 0) {
      const emptyEl = contentEl.createDiv({ cls: 'vaultend-empty-state' });
      const iconEl = emptyEl.createSpan({ cls: 'vaultend-empty-state-icon' });
      setIcon(iconEl, 'check-circle');
      emptyEl.createSpan({ text: t('maintenance.vaultClean') });
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
    if (counts['duplicate-tags'] > 0) parts.push(t('summary.duplicateTags', { count: counts['duplicate-tags'] }));
    summaryEl.createEl('p', { text: parts.join(' · ') });

    if (plan.tokenUsage && plan.tokenUsage.totalTokens > 0) {
      const hasCostData = plan.tokenUsage.estimatedCostUsd >= 0;
      summaryEl.createSpan({
        text: hasCostData
          ? t('maintenance.tokenTotal', { count: plan.tokenUsage.totalTokens.toLocaleString(), cost: plan.tokenUsage.estimatedCostUsd.toFixed(4) })
          : t('maintenance.tokenTotalUnavailable', { count: plan.tokenUsage.totalTokens.toLocaleString() }),
        cls: 'maintenance-token-info',
      });
    }

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
    if (this.isTypeVisible('duplicate-tags') && plan.duplicateTags.length > 0) {
      this.renderDuplicateTags(contentEl, plan.duplicateTags);
    }
    if (this.isTypeVisible('untagged') && plan.untaggedNotes.length > 0) {
      this.renderUntaggedNotes(contentEl, plan.untaggedNotes, plan.missingTags);
    }
    if (this.isTypeVisible('missing-tags') && plan.missingTags.length > 0) {
      this.renderMissingTags(contentEl, plan.missingTags);
    }

    if (this.filterState.searchQuery) {
      const input = contentEl.querySelector<HTMLInputElement>('.maintenance-search-input');
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
      chip.addClass(`severity-chip-${sev}`);

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
      empty: plan.emptyNotes.filter(i => !this.dismissedIds.has(`empty:${i.notePath}`)).length,
      untagged: plan.untaggedNotes.filter(p => !this.dismissedIds.has(`untagged:${p}`)).length,
      'missing-tags': plan.missingTags.filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath}`)).length,
      'broken-link': plan.brokenLinks.filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath}:${i.lineNumber}:${i.targetLink}`)).length,
      orphan: plan.orphanNotes.filter(e => !this.dismissedIds.has(`orphan:${e.notePath}`)).length,
      duplicate: plan.duplicateCandidates.filter(p => !this.dismissedIds.has(`duplicate:${p.noteA}|${p.noteB}`)).length,
      'duplicate-tags': plan.duplicateTags.filter(g => !this.dismissedIds.has(`duplicate-tags:${g.canonicalTag}`)).length,
    };
  }

  // ─── Section Headings with Severity Badge ───

  private renderSectionHeading(container: HTMLElement, issueType: MaintenanceIssueType, label: string): HTMLElement {
    const section = container.createDiv(`maintenance-section maintenance-section--${getSeverity(issueType)}`);
    const heading = section.createEl('h5', { cls: 'maintenance-section-heading maintenance-section-collapsible' });
    const collapseIcon = heading.createSpan({ cls: 'maintenance-section-collapse-icon' });
    setIcon(collapseIcon, 'chevron-down');
    const severity = getSeverity(issueType);
    const badge = heading.createSpan({ cls: `maintenance-severity-badge severity-${severity}` });
    badge.textContent = t(`severity.${severity}` as const);
    heading.appendText(` ${label}`);
    const content = section.createDiv({ cls: 'maintenance-section-content' });
    heading.setAttribute('tabindex', '0');
    heading.setAttribute('role', 'button');
    heading.setAttribute('aria-expanded', 'true');
    const toggleCollapse = (): void => {
      const collapsed = !section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', collapsed);
      heading.setAttribute('aria-expanded', String(!collapsed));
    };
    heading.addEventListener('click', toggleCollapse);
    heading.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapse();
      }
    });
    return content;
  }

  private applyCardClass(setting: Setting, issueType: MaintenanceIssueType): void {
    setting.settingEl.addClass('maintenance-card', `maintenance-card--${getSeverity(issueType)}`);
  }

  // ─── Section Renderers ───

  private renderEmptyNotes(container: HTMLElement, items: ReadonlyArray<EmptyNoteEntry>): void {
    const filtered = items
      .filter(i => !this.dismissedIds.has(`empty:${i.notePath}`))
      .filter(i => this.matchesSearch(i.notePath));
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'empty', t('issue.emptyNotes', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(
      section, entries, t('batch.selectedArchive'), false,
      t('batch.selectedDelete'),
      (e) => this.executeBatchWithAction(e, { kind: 'delete-orphan' }),
      true,
    );

    for (const item of filtered) {
      const settingEl = new Setting(section)
        .setName(this.basename(item.notePath))
        .setDesc(item.notePath);
      this.applyCardClass(settingEl, 'empty');

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
        identifier: item.notePath,
        status: 'pending',
      });
      const emptyEntry = entries[entries.length - 1];

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(item.notePath)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.archive'))
        .setCta()
        .onClick(() => { void this.archiveWithConfig(item.notePath, settingEl, `empty:${item.notePath}`, emptyEntry); }),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.delete'))
        .setWarning()
        .onClick(() => { void this.executeAction(
          { kind: 'delete-orphan', notePath: item.notePath },
          settingEl,
          `empty:${item.notePath}`,
          emptyEntry,
        ); }),
      );

      this.addDismissButton(settingEl, 'empty', item.notePath);
      this.applyPersistedState(emptyEntry);
    }
  }

  private renderUntaggedNotes(container: HTMLElement, items: ReadonlyArray<NotePath>, _missingTags?: ReadonlyArray<MissingTagSuggestion>): void {
    const filtered = items
      .filter(p => !this.dismissedIds.has(`untagged:${p}`))
      .filter(p => this.matchesSearch(p));
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'untagged', t('issue.untaggedNotes', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(section, entries);
    if (this.onOrganizeTagsOnly) {
      this.addOrganizeButton(section, entries, this.onOrganizeTagsOnly, true);
    }

    for (const notePath of filtered) {
      const settingEl = new Setting(section)
        .setName(this.basename(notePath));
      settingEl.descEl.createDiv({ text: notePath, cls: 'maintenance-card-path' });
      this.applyCardClass(settingEl, 'untagged');

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'dismiss', issueType: 'untagged', identifier: notePath },
        setting: settingEl,
        issueType: 'untagged',
        identifier: notePath,
        status: 'pending',
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(notePath)),
      );

      this.addDismissButton(settingEl, 'untagged', notePath);
      this.applyPersistedState(entries[entries.length - 1]);
    }
  }

  private renderMissingTags(container: HTMLElement, items: ReadonlyArray<MissingTagSuggestion>): void {
    const filtered = items
      .filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath}`))
      .filter(i => this.matchesSearch(i.notePath));
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'missing-tags', t('issue.missingTags', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(section, entries);
    if (this.onOrganizeTagsOnly) {
      this.addOrganizeButton(section, entries, this.onOrganizeTagsOnly, true);
    }

    for (const item of filtered) {
      const settingEl = new Setting(section)
        .setName(this.basename(item.notePath));
      settingEl.descEl.createDiv({ text: item.notePath, cls: 'maintenance-card-path' });
      this.applyCardClass(settingEl, 'missing-tags');

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'dismiss', issueType: 'missing-tags', identifier: item.notePath },
        setting: settingEl,
        issueType: 'missing-tags',
        identifier: item.notePath,
        status: 'pending',
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(item.notePath)),
      );

      this.addDismissButton(settingEl, 'missing-tags', item.notePath);
      this.applyPersistedState(entries[entries.length - 1]);
    }
  }

  private renderBrokenLinks(container: HTMLElement, items: ReadonlyArray<BrokenLink>): void {
    const filtered = items
      .filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath}:${i.lineNumber}:${i.targetLink}`))
      .filter(i => this.matchesSearch(i.sourcePath));
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'broken-link', t('issue.brokenLinks', { count: filtered.length }));

    const hasFixes = filtered.some(i => i.suggestedFix);
    const entries: BatchEntry[] = [];
    this.renderBatchControls(
      section, entries,
      t('batch.selectedRemoveLinks'), false,
      hasFixes ? t('batch.selectedFixLinks') : undefined,
      hasFixes ? (e) => this.batchFixBrokenLinks(e) : undefined,
      false,
      (e) => this.batchRemoveBrokenLinks(e),
    );

    for (const item of filtered) {
      const desc = item.suggestedFix
        ? `[[${item.targetLink}]] → [[${item.suggestedFix}]] (${Math.round((item.fixConfidence ?? 0) * 100)}%)`
        : `[[${item.targetLink}]]`;
      const settingEl = new Setting(section)
        .setName(`${this.basename(item.sourcePath)}:${item.lineNumber}`)
        .setDesc(desc);
      this.applyCardClass(settingEl, 'broken-link');

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: item.suggestedFix
          ? { kind: 'fix-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, fixedTarget: item.suggestedFix, lineNumber: item.lineNumber } satisfies FixBrokenLink
          : { kind: 'remove-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, lineNumber: item.lineNumber },
        setting: settingEl,
        issueType: 'broken-link',
        identifier: `${item.sourcePath}:${item.lineNumber}:${item.targetLink}`,
        status: 'pending',
      });
      const linkEntry = entries[entries.length - 1];

      const brokenLinkKey = `broken-link:${item.sourcePath}:${item.lineNumber}:${item.targetLink}`;

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(item.sourcePath)),
      );

      if (item.suggestedFix) {
        settingEl.addButton(btn => btn
          .setButtonText(t('btn.fixLink'))
          .setCta()
          .onClick(() => { void this.executeAction(
            { kind: 'fix-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, fixedTarget: item.suggestedFix!, lineNumber: item.lineNumber } satisfies FixBrokenLink,
            settingEl,
            brokenLinkKey,
            linkEntry,
          ); }),
        );
      }

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.removeLink'))
        .onClick(() => { void this.executeAction(
          { kind: 'remove-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, lineNumber: item.lineNumber },
          settingEl,
          brokenLinkKey,
          linkEntry,
        ); }),
      );

      this.addDismissButton(settingEl, 'broken-link', `${item.sourcePath}:${item.lineNumber}:${item.targetLink}`);
      this.applyPersistedState(linkEntry);
    }
  }

  private renderOrphanNotes(container: HTMLElement, items: ReadonlyArray<OrphanNoteEntry>): void {
    const filtered = items
      .filter(e => !this.dismissedIds.has(`orphan:${e.notePath}`))
      .filter(e => this.matchesSearch(e.notePath))
      .slice()
      .sort((a, b) => b.fileSize - a.fileSize);
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'orphan', t('issue.orphanNotes', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(
      section, entries, t('batch.selectedArchive'), false,
      t('batch.selectedDelete'),
      (e) => this.executeBatchWithAction(e, { kind: 'delete-orphan' }),
      true,
    );
    if (this.onOrganizePreview) {
      this.addOrganizeButton(section, entries);
    }

    for (const entry of filtered) {
      const sizeStr = this.formatFileSize(entry.fileSize);
      const settingEl = new Setting(section)
        .setName(this.basename(entry.notePath));
      settingEl.descEl.createDiv({ text: `${entry.notePath} · ${sizeStr}`, cls: 'maintenance-card-path' });
      this.applyCardClass(settingEl, 'orphan');

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'archive-note', notePath: entry.notePath, targetFolder: '' },
        setting: settingEl,
        issueType: 'orphan',
        identifier: entry.notePath,
        status: 'pending',
      });
      const orphanEntry = entries[entries.length - 1];

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(entry.notePath)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.archive'))
        .onClick(() => { void this.archiveWithConfig(entry.notePath, settingEl, `orphan:${entry.notePath}`, orphanEntry); }),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.delete'))
        .setWarning()
        .onClick(() => { void this.executeAction(
          { kind: 'delete-orphan', notePath: entry.notePath },
          settingEl,
          `orphan:${entry.notePath}`,
          orphanEntry,
        ); }),
      );

      this.addDismissButton(settingEl, 'orphan', entry.notePath);
      this.applyPersistedState(orphanEntry);
    }
  }

  private renderDuplicates(container: HTMLElement, items: ReadonlyArray<DuplicatePair>): void {
    const filtered = items
      .filter(p => !this.dismissedIds.has(`duplicate:${p.noteA}|${p.noteB}`))
      .filter(p => this.matchesSearch(p.noteA) || this.matchesSearch(p.noteB));
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'duplicate', t('issue.duplicates', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(section, entries);

    for (const pair of filtered) {
      const score = Math.round(pair.similarityScore * 100);
      const settingEl = new Setting(section)
        .setName(`${this.basename(pair.noteA)} ↔ ${this.basename(pair.noteB)}`)
        .setDesc(t('duplicate.similarity', { score }));
      this.applyCardClass(settingEl, 'duplicate');

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'dismiss', issueType: 'duplicate', identifier: `${pair.noteA}|${pair.noteB}` },
        setting: settingEl,
        issueType: 'duplicate',
        identifier: `${pair.noteA}|${pair.noteB}`,
        status: 'pending',
      });

      this.addNoteSelect(settingEl, [pair.noteA, pair.noteB]);

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.openSideBySide'))
        .onClick(() => this.openFileSplit(pair.noteA, pair.noteB)),
      );

      this.addDismissButton(settingEl, 'duplicate', `${pair.noteA}|${pair.noteB}`);
      this.applyPersistedState(entries[entries.length - 1]);
    }
  }

  private renderDuplicateTags(container: HTMLElement, items: ReadonlyArray<DuplicateTagGroup>): void {
    const filtered = items
      .filter(g => !this.dismissedIds.has(`duplicate-tags:${g.canonicalTag}`))
      .filter(g => this.matchesSearch(g.canonicalTag)
        || g.variants.some(v => this.matchesSearch(v.tag)));
    if (filtered.length === 0) return;
    const section = this.renderSectionHeading(container, 'duplicate-tags', t('issue.duplicateTags', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(section, entries, t('batch.selectedMergeTags'));

    for (const group of filtered) {
      const variantTags = group.variants.map(v => `${v.tag} (${v.count})`).join(', ');
      const settingEl = new Setting(section)
        .setName(t('duplicateTag.keep', { tag: group.canonicalTag }));
      settingEl.descEl.createDiv({ text: t('duplicateTag.variants', { tags: variantTags }), cls: 'maintenance-card-path' });
      settingEl.descEl.createDiv({ text: t('duplicateTag.affected', { count: group.affectedNotes.length }), cls: 'maintenance-card-path' });
      this.applyCardClass(settingEl, 'duplicate-tags');

      const replaceTags = group.variants
        .filter(v => v.tag !== group.canonicalTag)
        .map(v => v.tag);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: {
          kind: 'merge-duplicate-tags',
          keepTag: group.canonicalTag,
          replaceTags,
          affectedNotes: group.affectedNotes,
        },
        setting: settingEl,
        issueType: 'duplicate-tags',
        identifier: group.canonicalTag,
        status: 'pending',
      });
      const dupTagEntry = entries[entries.length - 1];

      this.addNoteSelect(settingEl, group.affectedNotes);

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.mergeTags'))
        .setCta()
        .onClick(() => {
          void this.executeAction(
            {
              kind: 'merge-duplicate-tags',
              keepTag: group.canonicalTag,
              replaceTags,
              affectedNotes: group.affectedNotes,
            },
            settingEl,
            `duplicate-tags:${group.canonicalTag}`,
            dupTagEntry,
          );
        }),
      );

      this.addDismissButton(settingEl, 'duplicate-tags', group.canonicalTag);
      this.applyPersistedState(dupTagEntry);
    }
  }

  // ─── Batch & Actions ───

  private renderBatchControls(
    container: HTMLElement,
    entries: BatchEntry[],
    primaryLabel?: string,
    primaryWarning = false,
    secondaryLabel?: string,
    secondaryActionOverride?: (entries: BatchEntry[]) => Promise<void>,
    secondaryWarning = false,
    primaryActionOverride?: (entries: BatchEntry[]) => Promise<void>,
  ): void {
    const batchSetting = new Setting(container)
      .setClass('maintenance-batch-controls')
      .setName(t('batch.selectAll'));

    const selectAllCheckbox = createEl('input', { type: 'checkbox' });
    selectAllCheckbox.addClass('maintenance-batch-checkbox', 'maintenance-select-all');
    selectAllCheckbox.addEventListener('change', () => {
      entries.forEach(e => { e.checkbox.checked = selectAllCheckbox.checked; });
    });
    batchSetting.settingEl.prepend(selectAllCheckbox);

    if (primaryLabel) {
      batchSetting.addButton(btn => {
        btn.setButtonText(primaryLabel)
          .onClick(() => primaryActionOverride ? primaryActionOverride(entries) : this.executeBatch(entries));
        if (primaryWarning) btn.setWarning();
      });
    }

    if (secondaryLabel && secondaryActionOverride) {
      batchSetting.addButton(btn => {
        btn.setButtonText(secondaryLabel)
          .onClick(() => secondaryActionOverride(entries));
        if (secondaryWarning) btn.setWarning();
      });
    }

    batchSetting.addButton(btn => btn
      .setButtonText(t('batch.selectedDismiss'))
      .onClick(() => { void this.dismissBatch(entries); }),
    );

    batchSetting.addButton(btn => btn
      .setButtonText(t('batch.selectedRestore'))
      .onClick(() => { void this.restoreBatch(entries); }),
    );
  }

  private prependCheckbox(setting: Setting): HTMLInputElement {
    const checkbox = createEl('input', { type: 'checkbox' });
    checkbox.addClass('maintenance-batch-checkbox');
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

        setting.settingEl.addClass('maintenance-result-applied');
        setting.settingEl.querySelectorAll('button').forEach(b => b.remove());
        setting.settingEl.querySelectorAll('.setting-editor-extra-setting-button').forEach(b => b.remove());
        const cb = setting.settingEl.querySelector('.maintenance-batch-checkbox');
        if (cb) cb.remove();
        setting.setDesc(t('notice.dismissed'));

        setting.addButton(b => b
          .setButtonText(t('log.undo'))
          .setWarning()
          .onClick(() => {
            this.dismissedIds.delete(`${issueType}:${identifier}`);
            this.render();
          }),
        );
        this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
      }),
    );
  }

  private async archiveWithConfig(notePath: NotePath, setting: Setting, appliedKey?: string, batchEntry?: BatchEntry): Promise<void> {
    const settings = await this.configPort.getSettings();
    await this.executeAction(
      { kind: 'archive-note', notePath, targetFolder: settings.maintenanceArchiveFolder },
      setting,
      appliedKey,
      batchEntry,
    );
  }

  private async executeAction(action: MaintenanceAction, setting: Setting, appliedKey?: string, batchEntry?: BatchEntry): Promise<void> {
    try {
      const result: ApplyResult | null = await this.applyAction.execute(action);
      if (!result) {
        if (action.kind === 'merge-duplicate-tags') {
          setting.settingEl.addClass('maintenance-result-applied');
          setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
          if (batchEntry) {
            batchEntry.checkbox.checked = false;
            batchEntry.status = 'applied';
          } else {
            const cb = setting.settingEl.querySelector('.maintenance-batch-checkbox');
            if (cb) cb.remove();
          }
          setting.setDesc(t('maintenance.applied'));
          new Notice(t('notice.actionApplied'));
          return;
        }
        new Notice(t('notice.noChangeNeeded'));
        return;
      }
      setting.settingEl.addClass('maintenance-result-applied');
      setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
      if (batchEntry) {
        batchEntry.checkbox.checked = false;
        batchEntry.status = 'applied';
      } else {
        const cb = setting.settingEl.querySelector('.maintenance-batch-checkbox');
        if (cb) cb.remove();
      }
      if (result.undoable && appliedKey) {
        this.appliedEntries.set(appliedKey, result.entryId);
        if (batchEntry) batchEntry.historyEntryId = result.entryId;
        this.addRestoreButton(setting, result.entryId, appliedKey);
      } else if (batchEntry) {
        batchEntry.checkbox.disabled = true;
      }
      setting.setDesc(t('maintenance.applied'));
      new Notice(t('notice.actionApplied'));
      this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
    } catch (err) {
      new Notice(t('notice.actionFailed', { error: localizeError(err) }));
    }
  }

  private addRestoreButton(setting: Setting, historyEntryId: string, appliedKey: string): void {
    setting.addButton(btn => btn
      .setButtonText(t('log.undo'))
      .setWarning()
      .onClick(async () => {
        btn.setDisabled(true);
        try {
          await this.historyPort.undo(historyEntryId);
          this.appliedEntries.delete(appliedKey);
          this.render();
          new Notice(t('undo.success'));
          this.app.workspace.trigger(HISTORY_CHANGED_EVENT, historyEntryId);
        } catch (err) {
          btn.setDisabled(false);
          new Notice(t('undo.failed', { error: localizeError(err) }));
        }
      }),
    );
  }

  private applyPersistedState(entry: BatchEntry): void {
    const key = `${entry.issueType}:${entry.identifier}`;
    const historyEntryId = this.appliedEntries.get(key);
    if (!historyEntryId) return;
    entry.status = 'applied';
    entry.historyEntryId = historyEntryId;
    entry.setting.settingEl.addClass('maintenance-result-applied');
    entry.setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
    entry.checkbox.checked = false;
    entry.setting.setDesc(t('maintenance.applied'));
    this.addRestoreButton(entry.setting, historyEntryId, key);
  }

  private async executeBatch(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked && e.status === 'pending');
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }

    const archiveFolder = await this.getArchiveFolder();
    let success = 0;
    let failed = 0;
    for (const entry of selected) {
      try {
        let action = entry.action;
        if (action.kind === 'archive-note' && !action.targetFolder) {
          action = { ...action, targetFolder: archiveFolder };
        }
        const result = await this.applyAction.execute(action);
        if (!result) {
          failed++;
          continue;
        }
        entry.setting.settingEl.addClass('maintenance-result-applied');
        entry.setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
        entry.checkbox.checked = false;
        entry.status = 'applied';
        const appliedKey = `${entry.issueType}:${entry.identifier}`;
        if (result.undoable) {
          entry.historyEntryId = result.entryId;
          this.appliedEntries.set(appliedKey, result.entryId);
          this.addRestoreButton(entry.setting, result.entryId, appliedKey);
        } else {
          entry.checkbox.disabled = true;
        }
        entry.setting.setDesc(t('maintenance.applied'));
        success++;
      } catch {
        failed++;
      }
    }
    const msg = failed > 0
      ? t('notice.batchResult', { success, failed })
      : t('notice.batchComplete', { count: success });
    new Notice(msg);
    if (success > 0) this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
  }

  private async batchRemoveBrokenLinks(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked && e.status === 'pending');
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }
    const originals = selected.map(e => e.action);
    for (const e of selected) {
      if (e.action.kind === 'fix-broken-link') {
        e.action = { kind: 'remove-broken-link', sourcePath: e.action.sourcePath, targetLink: e.action.targetLink, lineNumber: e.action.lineNumber };
      }
    }
    try {
      await this.executeBatch(entries);
    } finally {
      selected.forEach((e, i) => { e.action = originals[i]; });
    }
  }

  private async batchFixBrokenLinks(entries: BatchEntry[]): Promise<void> {
    const fixable = entries.filter(e => e.checkbox.checked && e.status === 'pending' && e.action.kind === 'fix-broken-link');
    if (fixable.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }
    await this.executeBatch(fixable);
  }

  private async executeBatchWithAction(
    entries: BatchEntry[],
    actionOverride: { kind: string },
  ): Promise<void> {
    const originals = entries.map(e => e.action);
    for (const e of entries) {
      const notePath = 'notePath' in e.action ? e.action.notePath : undefined;
      if (!notePath) continue;
      e.action = actionOverride.kind === 'delete-orphan'
        ? { kind: 'delete-orphan' as const, notePath }
        : { kind: 'archive-note' as const, notePath, targetFolder: '' };
    }
    try {
      await this.executeBatch(entries);
    } finally {
      entries.forEach((e, i) => { e.action = originals[i]; });
    }
  }

  private async dismissBatch(entries: BatchEntry[]): Promise<void> {
    const selected = entries.filter(e => e.checkbox.checked && e.status !== 'applied');
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }
    let success = 0;
    let failed = 0;
    for (const entry of selected) {
      try {
        await this.applyAction.execute({
          kind: 'dismiss',
          issueType: entry.issueType,
          identifier: entry.identifier,
        });
        const dismissKey = `${entry.issueType}:${entry.identifier}`;
        this.dismissedIds.add(dismissKey);

        entry.setting.settingEl.addClass('maintenance-result-applied');
        entry.setting.settingEl.querySelectorAll('button').forEach(b => b.remove());
        entry.setting.settingEl.querySelectorAll('.setting-editor-extra-setting-button').forEach(b => b.remove());
        entry.checkbox.remove();
        entry.status = 'applied';
        entry.setting.setDesc(t('notice.dismissed'));

        entry.setting.addButton(b => b
          .setButtonText(t('log.undo'))
          .setWarning()
          .onClick(() => {
            this.dismissedIds.delete(dismissKey);
            this.render();
          }),
        );
        success++;
      } catch {
        failed++;
      }
    }
    const msg = failed > 0
      ? t('notice.batchResult', { success, failed })
      : t('notice.batchDismissed', { count: success });
    new Notice(msg);
    if (success > 0) this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
  }

  private async restoreBatch(entries: BatchEntry[]): Promise<void> {
    const restorable = entries.filter(e => e.checkbox.checked && e.status === 'applied' && e.historyEntryId);
    if (restorable.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }
    this.restoreInProgress = true;
    let success = 0;
    let failed = 0;
    try {
      for (const entry of [...restorable].reverse()) {
        try {
          await this.historyPort.undo(entry.historyEntryId!);
          const appliedKey = `${entry.issueType}:${entry.identifier}`;
          this.appliedEntries.delete(appliedKey);
          entry.status = 'restored';
          success++;
        } catch {
          failed++;
        }
      }
      const msg = failed > 0
        ? t('notice.batchRestoreResult', { success, failed })
        : t('notice.batchRestored', { count: success });
      new Notice(msg);
      if (success > 0) {
        this.render();
        this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
      }
    } finally {
      this.restoreInProgress = false;
    }
  }

  private addOrganizeButton(
    section: HTMLElement,
    entries: BatchEntry[],
    previewFn?: (notePaths: NotePath[], onProgress?: (current: number, total: number) => void) => Promise<Array<{ notePath: NotePath; result: OrganizeResult }>>,
    tagsOnly: boolean = false,
  ): void {
    const batchControls = section.querySelector('.maintenance-batch-controls .setting-item-control');
    if (!batchControls) return;
    const btn = batchControls.createEl('button', {
      cls: 'mod-cta',
      text: t('batch.selectedOrganize'),
    });
    batchControls.prepend(btn);
    btn.addEventListener('click', () => { void this.executeOrganizeBatch(btn, entries, previewFn, tagsOnly); });
  }

  private async executeOrganizeBatch(
    btn: HTMLButtonElement,
    entries: BatchEntry[],
    previewFn?: (notePaths: NotePath[], onProgress?: (current: number, total: number) => void) => Promise<Array<{ notePath: NotePath; result: OrganizeResult }>>,
    tagsOnly: boolean = false,
  ): Promise<void> {
    const preview = previewFn ?? this.onOrganizePreview;
    if (!preview || !this.batchOrganizeCallbacks) return;
    const selected = entries.filter(e => e.checkbox.checked && e.status === 'pending');
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }
    const notePaths = selected
      .map(e => 'notePath' in e.action ? (e.action as { notePath: NotePath }).notePath : createNotePath(e.identifier))
      .filter((p): p is NotePath => !!p);

    if (notePaths.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }

    const originalText = btn.textContent ?? '';
    btn.disabled = true;
    btn.textContent = t('organize.processing', { current: 0, total: notePaths.length });

    try {
      const previews = await preview(notePaths, (current, total) => {
        btn.textContent = t('organize.processing', { current, total });
      });
      btn.textContent = originalText;
      btn.disabled = false;

      const items: BatchPreviewItem[] = previews.map(p => ({
        notePath: p.notePath,
        result: p.result,
      }));

      if (items.length === 0) {
        new Notice(t('organize.noChanges'));
        return;
      }

      new OrganizeBatchPreviewModal(this.app, items, this.batchOrganizeCallbacks, tagsOnly)
        .setOnApplied((appliedEntries) => this.onBatchOrganizeApplied(appliedEntries, entries))
        .open();
    } catch (err) {
      btn.textContent = originalText;
      btn.disabled = false;
      new Notice(t('notice.actionFailed', { error: String(err) }));
    }
  }

  private onBatchOrganizeApplied(appliedEntries: ReadonlyArray<BatchAppliedEntry>, batchEntries: BatchEntry[]): void {
    for (const applied of appliedEntries) {
      const pathStr = applied.notePath;
      const entry = batchEntries.find(e => e.identifier === pathStr && e.status === 'pending');
      if (!entry) continue;

      entry.status = 'applied';
      entry.historyEntryId = applied.historyEntryId;
      entry.checkbox.checked = false;
      entry.setting.settingEl.addClass('maintenance-result-applied');
      entry.setting.settingEl.querySelectorAll('button').forEach(btn => btn.remove());
      entry.setting.setDesc(t('maintenance.applied'));

      const appliedKey = `${entry.issueType}:${entry.identifier}`;
      this.appliedEntries.set(appliedKey, applied.historyEntryId);
      this.addRestoreButton(entry.setting, applied.historyEntryId, appliedKey);
    }
    this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
  }

  private async getArchiveFolder(): Promise<string> {
    const settings = await this.configPort.getSettings();
    return settings.maintenanceArchiveFolder;
  }

  // ─── Utilities ───

  private addNoteSelect(setting: Setting, notes: ReadonlyArray<NotePath>): void {
    if (notes.length === 0) return;
    let selected = '';
    setting.addDropdown(dropdown => {
      dropdown.addOption('', t('btn.showNotes', { count: notes.length }));
      for (const note of notes) {
        dropdown.addOption(note, this.basename(note));
      }
      dropdown.onChange(value => { selected = value; });
    });
    setting.addButton(btn => btn
      .setButtonText(t('btn.open'))
      .onClick(() => {
        if (selected) this.openFile(selected);
      }),
    );
  }

  private basename(path: NotePath): string {
    return path.split('/').pop()?.replace('.md', '') ?? path;
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
