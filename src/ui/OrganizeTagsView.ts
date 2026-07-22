import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { OrganizeTagsUseCase, OrganizeTagsResult, OrganizeTagsProgress } from '../application/usecases/OrganizeTagsUseCase';
import { ApplyMaintenanceActionUseCase } from '../application/usecases/ApplyMaintenanceActionUseCase';
import { HistoryPort } from '../application/ports/HistoryPort';
import { DuplicateTagGroup } from '../domain/models/OrganizeModels';
import { TagName } from '../domain/values/TagName';
import { ORGANIZE_TAGS_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
import { OrganizeTagEditModal } from './OrganizeTagEditModal';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export { ORGANIZE_TAGS_VIEW_TYPE };

type GroupStatus = 'pending' | 'applied' | 'skipped';

interface TagGroupEntry {
  group: DuplicateTagGroup;
  status: GroupStatus;
  historyEntryId?: string;
  checkbox: HTMLInputElement;
  container: HTMLElement;
  setting: Setting;
}

export class OrganizeTagsView extends ItemView {
  private result: OrganizeTagsResult | null = null;
  private scanning = false;
  private entries: TagGroupEntry[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly organizeTagsUseCase: OrganizeTagsUseCase,
    private readonly applyAction: ApplyMaintenanceActionUseCase,
    private readonly historyPort: HistoryPort,
    private readonly openFile: (path: string) => void,
  ) {
    super(leaf);
  }

  getViewType(): string { return ORGANIZE_TAGS_VIEW_TYPE; }
  getDisplayText(): string { return t('organizeTags.viewTitle'); }
  getIcon(): string { return 'tags'; }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on(HISTORY_CHANGED_EVENT, (undoneId?: string) =>
        this.onHistoryChanged(undoneId)),
    );
    this.renderEmpty();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private onHistoryChanged(undoneId?: string): void {
    if (!undoneId || this.entries.length === 0) return;
    const entry = this.entries.find(e => e.historyEntryId === undoneId);
    if (!entry || entry.status !== 'applied') return;

    entry.status = 'pending';
    entry.historyEntryId = undefined;
    entry.container.removeClass('organize-tags-entry-applied');

    const undoBtn = entry.setting.controlEl.querySelector('.mod-warning');
    if (undoBtn) undoBtn.remove();

    entry.setting.addButton(btn =>
      btn.setButtonText(t('organizeTags.apply'))
        .setCta()
        .onClick(() => this.applyEntry(entry)),
    );
    entry.setting.addButton(btn =>
      btn.setButtonText(t('organizeTags.edit'))
        .onClick(() => this.editEntry(entry)),
    );
  }

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h4', { text: t('organizeTags.viewTitle') });

    new Setting(this.contentEl)
      .setDesc(t('organizeTags.description'))
      .addButton(btn =>
        btn.setButtonText(t('organizeTags.startScan'))
          .setCta()
          .onClick(() => this.triggerScan()),
      );
  }

  async triggerScan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.entries = [];
    this.result = null;

    this.renderProgress({ phase: 'normalization' });

    try {
      const result = await this.organizeTagsUseCase.execute((info: OrganizeTagsProgress) => {
        this.renderProgress(info);
      });
      this.result = result;
      this.scanning = false;
      this.render();
    } catch (err) {
      this.scanning = false;
      this.renderError(err);
    }
  }

  private renderProgress(info: OrganizeTagsProgress): void {
    this.contentEl.empty();
    this.contentEl.createEl('h4', { text: t('organizeTags.viewTitle') });

    const status = this.contentEl.createDiv({ cls: 'organize-tags-progress' });

    const phaseLabel = info.phase === 'normalization'
      ? t('organizeTags.phaseNormalization')
      : info.phase === 'llm'
        ? t('organizeTags.phaseLLM')
        : t('organizeTags.phaseBuilding');

    status.createEl('p', { text: phaseLabel, cls: 'organize-tags-scanning' });

    if (info.current !== undefined && info.total !== undefined) {
      status.createEl('p', {
        text: t('organizeTags.batchProgress', {
          current: String(info.current),
          total: String(info.total),
        }),
        cls: 'organize-tags-counter',
      });
      const barContainer = status.createDiv({ cls: 'inbox-progress-bar-container' });
      const barFill = barContainer.createDiv({ cls: 'inbox-progress-bar-fill' });
      barFill.style.width = `${Math.round((info.current / info.total) * 100)}%`;
    }
  }

  private renderError(err: unknown): void {
    this.contentEl.empty();
    this.contentEl.createEl('h4', { text: t('organizeTags.viewTitle') });
    this.contentEl.createEl('p', {
      text: t('organizeTags.scanFailed', { error: localizeError(err) }),
      cls: 'organize-tags-error',
    });
    new Setting(this.contentEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeTags.startScan'))
          .setCta()
          .onClick(() => this.triggerScan()),
      );
  }

  private render(): void {
    this.contentEl.empty();
    this.entries = [];

    const result = this.result;
    if (!result) { this.renderEmpty(); return; }

    this.contentEl.createEl('h4', { text: t('organizeTags.viewTitle') });

    // Rescan
    new Setting(this.contentEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeTags.rescan'))
          .onClick(() => this.triggerScan()),
      );

    // Statistics
    const summaryEl = this.contentEl.createDiv({ cls: 'organize-tags-summary' });
    summaryEl.createEl('span', {
      text: t('organizeTags.stats', {
        total: String(result.totalTags),
        groups: String(result.groups.length),
        singleUse: String(result.singleUseTags),
      }),
    });

    if (result.fromCache) {
      summaryEl.createEl('span', {
        text: t('organizeTags.fromCache'),
        cls: 'organize-tags-cache-badge',
      });
    }

    if (result.tokenUsage) {
      summaryEl.createEl('span', {
        text: t('organizeTags.tokenTotal', {
          count: result.tokenUsage.totalTokens.toLocaleString(),
          cost: result.tokenUsage.estimatedCostUsd.toFixed(4),
        }),
        cls: 'organize-tags-token-info',
      });
    }

    if (result.groups.length === 0) {
      this.contentEl.createEl('p', {
        text: t('organizeTags.noGroups'),
        cls: 'organize-tags-empty',
      });
      return;
    }

    // Batch controls
    this.renderBatchControls();

    // Group cards
    const entriesContainer = this.contentEl.createDiv({ cls: 'organize-tags-entries' });
    for (const group of result.groups) {
      this.renderGroupCard(entriesContainer, group);
    }
  }

  private renderBatchControls(): void {
    const batchEl = this.contentEl.createDiv({ cls: 'organize-tags-batch-controls' });

    const selectAllContainer = batchEl.createDiv({ cls: 'maintenance-batch-checkbox' });
    const selectAllCheckbox = selectAllContainer.createEl('input', { type: 'checkbox' });
    selectAllContainer.createEl('span', { text: t('batch.selectAll') });
    selectAllCheckbox.addEventListener('change', () => {
      for (const entry of this.entries) {
        if (entry.status === 'pending' || entry.status === 'applied') {
          entry.checkbox.checked = selectAllCheckbox.checked;
        }
      }
    });

    new Setting(batchEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeTags.applySelected'))
          .setCta()
          .onClick(() => this.applyBatch()),
      )
      .addButton(btn =>
        btn.setButtonText(t('organizeTags.skipSelected'))
          .onClick(() => this.skipBatch()),
      )
      .addButton(btn =>
        btn.setButtonText(t('batch.selectedUndo'))
          .setWarning()
          .onClick(() => this.undoBatch()),
      );
  }

  private renderGroupCard(container: HTMLElement, group: DuplicateTagGroup): void {
    const groupType = group.groupType ?? 'merge';
    const entryContainer = container.createDiv({ cls: `organize-tags-entry organize-tags-type-${groupType}` });

    const setting = new Setting(entryContainer);

    // Type badge + name
    const nameEl = setting.nameEl;
    if (groupType === 'nest') {
      const badge = nameEl.createEl('span', { text: t('organizeTags.badgeNest'), cls: 'organize-tags-badge organize-tags-badge-nest' });
      nameEl.insertBefore(badge, nameEl.firstChild);
      nameEl.appendText(' ');
    } else if (groupType === 'relate') {
      const badge = nameEl.createEl('span', { text: t('organizeTags.badgeRelate'), cls: 'organize-tags-badge organize-tags-badge-relate' });
      nameEl.insertBefore(badge, nameEl.firstChild);
      nameEl.appendText(' ');
    }
    nameEl.appendText(group.canonicalTag as string);

    if (groupType === 'relate') {
      setting.setDesc(t('organizeTags.relateDesc'));
    } else {
      setting.setDesc(t('organizeTags.affectedNotes', { count: String(group.affectedNotes.length) }));
    }

    // Checkbox (not for relate groups)
    const checkboxEl = createEl('input', { type: 'checkbox' });
    checkboxEl.addClass('maintenance-batch-checkbox');
    if (groupType === 'relate') {
      checkboxEl.addClass('vaultend-hidden');
    }
    setting.settingEl.prepend(checkboxEl);

    const entry: TagGroupEntry = {
      group,
      status: groupType === 'relate' ? 'skipped' : 'pending',
      checkbox: checkboxEl,
      container: entryContainer,
      setting,
    };
    this.entries.push(entry);

    // Variant chips
    const detailsEl = entryContainer.createDiv({ cls: 'organize-tags-details' });
    const chipList = detailsEl.createDiv({ cls: 'organize-tag-list' });

    if (groupType === 'nest') {
      // Show transformation: child → nested path
      const childTag = group.variants.find(v => (v.tag as string) !== (group.canonicalTag as string));
      if (childTag) {
        const chip = chipList.createEl('span', { cls: 'organize-chip' });
        chip.createEl('span', { text: childTag.tag as string });
        chip.createEl('span', { text: String(childTag.count), cls: 'organize-chip-score' });
        chipList.createEl('span', { text: ' → ', cls: 'organize-tags-arrow' });
        const targetChip = chipList.createEl('span', { cls: 'organize-chip organize-chip-canonical' });
        targetChip.createEl('span', { text: group.canonicalTag as string });
      }
    } else {
      for (const v of group.variants) {
        const tagStr = v.tag as string;
        const isCanonical = tagStr === (group.canonicalTag as string);
        const chipClasses = ['organize-chip'];
        if (isCanonical) chipClasses.push('organize-chip-canonical');

        const chip = chipList.createEl('span', { cls: chipClasses.join(' ') });
        chip.createEl('span', { text: tagStr });
        chip.createEl('span', { text: String(v.count), cls: 'organize-chip-score' });
      }
    }

    // Affected notes (clickable) — not for relate
    if (groupType !== 'relate' && group.affectedNotes.length > 0) {
      const notesEl = detailsEl.createDiv({ cls: 'organize-tags-affected' });
      const maxShow = Math.min(group.affectedNotes.length, 3);
      for (let i = 0; i < maxShow; i++) {
        const notePath = group.affectedNotes[i] as unknown as string;
        const basename = notePath.split('/').pop()?.replace('.md', '') ?? notePath;
        const link = notesEl.createEl('a', { text: basename, cls: 'organize-tags-note-link' });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.openFile(notePath);
        });
      }
      if (group.affectedNotes.length > maxShow) {
        notesEl.createEl('span', {
          text: t('organizeTags.andMore', { count: String(group.affectedNotes.length - maxShow) }),
          cls: 'organize-tags-more',
        });
      }
    }

    // Action buttons — vary by type
    if (groupType === 'relate') {
      // Info only — no action buttons
    } else if (groupType === 'nest') {
      setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.applyNest'))
          .setCta()
          .onClick(() => this.applyEntry(entry)),
      );
      setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.skip'))
          .onClick(() => this.skipEntry(entry)),
      );
    } else {
      setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.apply'))
          .setCta()
          .onClick(() => this.applyEntry(entry)),
      );
      setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.edit'))
          .onClick(() => this.editEntry(entry)),
      );
      setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.skip'))
          .onClick(() => this.skipEntry(entry)),
      );
    }
  }

  private async applyEntry(entry: TagGroupEntry): Promise<boolean> {
    if (entry.status !== 'pending') return false;

    const group = entry.group;
    const keepTag = group.canonicalTag;
    const replaceTags = group.variants
      .filter(v => (v.tag as string) !== (keepTag as string))
      .map(v => v.tag);

    try {
      const result = await this.applyAction.execute({
        kind: 'merge-duplicate-tags',
        keepTag,
        replaceTags,
        affectedNotes: group.affectedNotes,
      });

      if (result) {
        entry.status = 'applied';
        entry.historyEntryId = result.entryId;
        this.markEntryApplied(entry);
        new Notice(t('notice.actionApplied'));
        this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
        return true;
      }
      return false;
    } catch (err) {
      new Notice(t('notice.actionFailed', { error: localizeError(err) }));
      return false;
    }
  }

  private async editEntry(entry: TagGroupEntry): Promise<void> {
    if (entry.status !== 'pending') return;

    const modal = new OrganizeTagEditModal(
      this.app,
      entry.group.canonicalTag,
      entry.group.variants,
    );
    const result = await modal.open();
    if (!result) return;

    // Update the group with edited data
    const updatedVariants = [
      { tag: result.canonical as TagName, count: entry.group.variants.find(v => (v.tag as string) === result.canonical)?.count ?? 0 },
      ...result.variants.map(v => ({
        tag: v as TagName,
        count: entry.group.variants.find(gv => (gv.tag as string) === v)?.count ?? 0,
      })),
    ];

    const oldGroup = entry.group;
    const updatedGroup: DuplicateTagGroup = {
      canonicalTag: result.canonical as TagName,
      variants: updatedVariants,
      affectedNotes: oldGroup.affectedNotes,
      groupType: oldGroup.groupType,
    };
    entry.group = updatedGroup;

    if (this.result) {
      const mutableGroups = this.result.groups.map(g => g === oldGroup ? updatedGroup : g);
      this.result = { ...this.result, groups: mutableGroups };
    }

    this.render();
  }

  private skipEntry(entry: TagGroupEntry): void {
    if (entry.status !== 'pending') return;
    entry.status = 'skipped';
    entry.container.addClass('organize-tags-entry-applied');
    entry.checkbox.addClass('vaultend-hidden');
    entry.setting.setDesc(t('organizeTags.skipped'));
    const buttons = entry.setting.controlEl.querySelectorAll('.mod-cta');
    buttons.forEach(btn => btn.remove());
    const editBtns = entry.setting.controlEl.querySelectorAll('button:not(.mod-warning)');
    editBtns.forEach(btn => btn.remove());
  }

  private markEntryApplied(entry: TagGroupEntry): void {
    entry.container.addClass('organize-tags-entry-applied');
    entry.checkbox.checked = false;

    const controlEl = entry.setting.controlEl;
    const buttons = controlEl.querySelectorAll('button');
    buttons.forEach(btn => {
      if (!btn.classList.contains('mod-warning')) btn.remove();
    });

    if (entry.historyEntryId) {
      entry.setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.undo'))
          .setWarning()
          .onClick(() => this.undoEntry(entry)),
      );
    }

    entry.setting.setDesc(t('organizeTags.applied'));
  }

  private async undoEntry(entry: TagGroupEntry): Promise<boolean> {
    if (!entry.historyEntryId) return false;
    const undoneId = entry.historyEntryId;
    try {
      await this.historyPort.undo(undoneId);
      entry.status = 'pending';
      entry.historyEntryId = undefined;

      entry.container.removeClass('organize-tags-entry-applied');

      const undoBtn = entry.setting.controlEl.querySelector('.mod-warning');
      if (undoBtn) undoBtn.remove();

      entry.setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.apply'))
          .setCta()
          .onClick(() => this.applyEntry(entry)),
      );
      entry.setting.addButton(btn =>
        btn.setButtonText(t('organizeTags.edit'))
          .onClick(() => this.editEntry(entry)),
      );
      entry.setting.setDesc(
        t('organizeTags.affectedNotes', { count: String(entry.group.affectedNotes.length) }),
      );
      new Notice(t('undo.success'));
      this.app.workspace.trigger(HISTORY_CHANGED_EVENT, undoneId);
      return true;
    } catch (err) {
      new Notice(t('undo.failed', { error: localizeError(err) }));
      return false;
    }
  }

  private async undoBatch(): Promise<void> {
    const selected = this.entries.filter(e => e.status === 'applied' && e.checkbox.checked);
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }

    let success = 0;
    let failed = 0;
    for (const entry of [...selected].reverse()) {
      const ok = await this.undoEntry(entry);
      if (ok) success++;
      else failed++;
    }
    new Notice(t('notice.batchRestoreResult', { success: String(success), failed: String(failed) }));
  }

  private async applyBatch(): Promise<void> {
    const selected = this.entries.filter(e => e.status === 'pending' && e.checkbox.checked);
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }

    let success = 0;
    let failed = 0;
    for (const entry of selected) {
      const ok = await this.applyEntry(entry);
      if (ok) success++;
      else failed++;
    }
    new Notice(t('notice.batchResult', { success: String(success), failed: String(failed) }));
  }

  private skipBatch(): void {
    const selected = this.entries.filter(e => e.status === 'pending' && e.checkbox.checked);
    if (selected.length === 0) {
      new Notice(t('notice.noSelection'));
      return;
    }

    for (const entry of selected) {
      this.skipEntry(entry);
    }
    new Notice(t('notice.batchComplete', { count: String(selected.length) }));
  }
}
