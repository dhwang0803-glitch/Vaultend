import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { RunMaintenanceUseCase } from '../application/usecases/RunMaintenanceUseCase';
import { ApplyMaintenanceActionUseCase, type ApplyResult } from '../application/usecases/ApplyMaintenanceActionUseCase';
import { MaintenancePlan, BrokenLink, MissingTagSuggestion, DuplicatePair, OrphanNoteEntry, EmptyNoteEntry, DuplicateTagGroup } from '../domain/models/OrganizeModels';
import type { MaintenanceAction, MaintenanceIssueType } from '../domain/models/MaintenanceAction';
import { NotePath } from '../domain/values/NotePath';
import type { SeverityLevel } from '../domain/values/Severity';
import { ISSUE_SEVERITY, getSeverity } from '../domain/values/Severity';
import type { ConfigPort } from '../application/ports/ConfigPort';
import type { HistoryPort } from '../application/ports/HistoryPort';
import type { LicensePort } from '../application/ports/LicensePort';
import { localizeError } from './localizeError';
import { MAINTENANCE_RESULT_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
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
    private readonly licensePort: LicensePort,
    private readonly openFile: (path: string) => void,
    private readonly openFileSplit: (pathA: string, pathB: string) => void,
    private readonly onMergeRequest: (pair: DuplicatePair) => void,
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
    if (counts['duplicate-tags'] > 0) parts.push(t('summary.duplicateTags', { count: counts['duplicate-tags'] }));
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
    if (this.isTypeVisible('duplicate-tags') && plan.duplicateTags.length > 0) {
      this.renderDuplicateTags(contentEl, plan.duplicateTags);
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
      empty: plan.emptyNotes.filter(i => !this.dismissedIds.has(`empty:${i.notePath as string}`)).length,
      untagged: plan.untaggedNotes.filter(p => !this.dismissedIds.has(`untagged:${p as string}`)).length,
      'missing-tags': plan.missingTags.filter(i => !this.dismissedIds.has(`missing-tags:${i.notePath as string}`)).length,
      'broken-link': plan.brokenLinks.filter(i => !this.dismissedIds.has(`broken-link:${i.sourcePath as string}:${i.lineNumber}:${i.targetLink}`)).length,
      orphan: plan.orphanNotes.filter(e => !this.dismissedIds.has(`orphan:${e.notePath as string}`)).length,
      duplicate: plan.duplicateCandidates.filter(p => !this.dismissedIds.has(`duplicate:${p.noteA as string}|${p.noteB as string}`)).length,
      'duplicate-tags': plan.duplicateTags.filter(g => !this.dismissedIds.has(`duplicate-tags:${g.canonicalTag as string}`)).length,
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
    this.renderBatchControls(
      container, entries, t('batch.selectedArchive'), false,
      t('batch.selectedDelete'),
      (e) => this.executeBatchWithAction(e, { kind: 'delete-orphan' }),
      true,
    );

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
        status: 'pending',
      });
      const emptyEntry = entries[entries.length - 1];

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(item.notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.archive'))
        .setCta()
        .onClick(() => this.archiveWithConfig(item.notePath, settingEl, `empty:${item.notePath as string}`, emptyEntry)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.delete'))
        .setWarning()
        .onClick(() => this.executeAction(
          { kind: 'delete-orphan', notePath: item.notePath },
          settingEl,
          `empty:${item.notePath as string}`,
          emptyEntry,
        )),
      );

      this.addDismissButton(settingEl, 'empty', item.notePath as string);
      this.applyPersistedState(emptyEntry);
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
        status: 'pending',
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(notePath as string)),
      );

      this.addDismissButton(settingEl, 'untagged', notePath as string);
      this.applyPersistedState(entries[entries.length - 1]);
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
        status: 'pending',
      });
      const tagEntry = entries[entries.length - 1];

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.applyTags'))
        .setCta()
        .onClick(() => this.executeAction(
          { kind: 'apply-missing-tags', notePath: item.notePath, tags: item.suggestedTags },
          settingEl,
          `missing-tags:${item.notePath as string}`,
          tagEntry,
        )),
      );

      this.addDismissButton(settingEl, 'missing-tags', item.notePath as string);
      this.applyPersistedState(tagEntry);
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
        status: 'pending',
      });
      const linkEntry = entries[entries.length - 1];

      const brokenLinkKey = `broken-link:${item.sourcePath as string}:${item.lineNumber}:${item.targetLink}`;

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.removeLink'))
        .onClick(() => this.executeAction(
          { kind: 'remove-broken-link', sourcePath: item.sourcePath, targetLink: item.targetLink, lineNumber: item.lineNumber },
          settingEl,
          brokenLinkKey,
          linkEntry,
        )),
      );

      this.addDismissButton(settingEl, 'broken-link', `${item.sourcePath as string}:${item.lineNumber}:${item.targetLink}`);
      this.applyPersistedState(linkEntry);
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
    this.renderBatchControls(
      container, entries, t('batch.selectedArchive'), false,
      t('batch.selectedDelete'),
      (e) => this.executeBatchWithAction(e, { kind: 'delete-orphan' }),
      true,
    );

    for (const entry of filtered) {
      const sizeStr = this.formatFileSize(entry.fileSize);
      const settingEl = new Setting(container)
        .setName(this.basename(entry.notePath))
        .setDesc(`${entry.notePath as string} · ${sizeStr}`);

      entries.push({
        checkbox: this.prependCheckbox(settingEl),
        action: { kind: 'archive-note', notePath: entry.notePath, targetFolder: '' },
        setting: settingEl,
        issueType: 'orphan',
        identifier: entry.notePath as string,
        status: 'pending',
      });
      const orphanEntry = entries[entries.length - 1];

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.open'))
        .onClick(() => this.openFile(entry.notePath as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.archive'))
        .onClick(() => this.archiveWithConfig(entry.notePath, settingEl, `orphan:${entry.notePath as string}`, orphanEntry)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.delete'))
        .setWarning()
        .onClick(() => this.executeAction(
          { kind: 'delete-orphan', notePath: entry.notePath },
          settingEl,
          `orphan:${entry.notePath as string}`,
          orphanEntry,
        )),
      );

      this.addDismissButton(settingEl, 'orphan', entry.notePath as string);
      this.applyPersistedState(orphanEntry);
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
        status: 'pending',
      });

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.openSideBySide'))
        .onClick(() => this.openFileSplit(pair.noteA as string, pair.noteB as string)),
      );

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.mergeWithAI'))
        .setCta()
        .onClick(async () => {
          if (!await this.licensePort.canUseFeature('organize-vault')) {
            new Notice(t('pro.featureLocked', { feature: t('pro.organizeVault') }));
            return;
          }
          this.onMergeRequest(pair);
        }),
      );

      this.addDismissButton(settingEl, 'duplicate', `${pair.noteA as string}|${pair.noteB as string}`);
      this.applyPersistedState(entries[entries.length - 1]);
    }
  }

  private renderDuplicateTags(container: HTMLElement, items: ReadonlyArray<DuplicateTagGroup>): void {
    const filtered = items
      .filter(g => !this.dismissedIds.has(`duplicate-tags:${g.canonicalTag as string}`))
      .filter(g => this.matchesSearch(g.canonicalTag as string)
        || g.variants.some(v => this.matchesSearch(v.tag as string)));
    if (filtered.length === 0) return;
    this.renderSectionHeading(container, 'duplicate-tags', t('issue.duplicateTags', { count: filtered.length }));

    const entries: BatchEntry[] = [];
    this.renderBatchControls(container, entries, t('batch.selectedMergeTags'));

    for (const group of filtered) {
      const variantTags = group.variants.map(v => `${v.tag as string} (${v.count})`).join(', ');
      const settingEl = new Setting(container)
        .setName(t('duplicateTag.keep', { tag: group.canonicalTag as string }))
        .setDesc(`${t('duplicateTag.variants', { tags: variantTags })} · ${t('duplicateTag.affected', { count: group.affectedNotes.length })}`);

      const replaceTags = group.variants
        .filter(v => (v.tag as string) !== (group.canonicalTag as string))
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
        identifier: group.canonicalTag as string,
        status: 'pending',
      });
      const dupTagEntry = entries[entries.length - 1];

      settingEl.addButton(btn => btn
        .setButtonText(t('btn.mergeTags'))
        .setCta()
        .onClick(async () => {
          this.executeAction(
            {
              kind: 'merge-duplicate-tags',
              keepTag: group.canonicalTag,
              replaceTags,
              affectedNotes: group.affectedNotes,
            },
            settingEl,
            `duplicate-tags:${group.canonicalTag as string}`,
            dupTagEntry,
          );
        }),
      );

      this.addDismissButton(settingEl, 'duplicate-tags', group.canonicalTag as string);
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
          .onClick(() => this.executeBatch(entries));
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
      .onClick(() => this.dismissBatch(entries)),
    );

    batchSetting.addButton(btn => btn
      .setButtonText(t('batch.selectedRestore'))
      .onClick(() => this.restoreBatch(entries)),
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
      for (const entry of restorable) {
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
