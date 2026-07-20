import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { OrganizeFolderUseCase, OrganizeFolderResult } from '../application/usecases/RunInboxProcessUseCase';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { OrganizeApplyActions } from './OrganizeResultModal';
import { ConfigPort } from '../application/ports/ConfigPort';
import { HistoryPort } from '../application/ports/HistoryPort';
import { VaultAccessPort } from '../application/ports/VaultAccessPort';
import { NotePath } from '../domain/values/NotePath';
import { createTimestamp } from '../domain/values/Timestamp';
import { ORGANIZE_FOLDER_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export { ORGANIZE_FOLDER_VIEW_TYPE };

type EntryStatus = 'pending' | 'applied' | 'skipped' | 'error';

interface OrganizeFolderEntry {
  result: OrganizeResult;
  checkbox: HTMLInputElement;
  setting: Setting;
  status: EntryStatus;
  historyEntryId?: string;
  selectedTags: string[];
  selectedLinks: NotePath[];
  selectedFolder: string | undefined;
  container: HTMLElement;
  currentPath?: string;
}

export class OrganizeFolderResultView extends ItemView {
  private currentResult: OrganizeFolderResult | null = null;
  private scanInProgress = false;
  private targetFolder: string | null = null;
  private entries: OrganizeFolderEntry[] = [];
  private abortController: AbortController | null = null;
  private autoApplyMode = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly organizeFolderUseCase: OrganizeFolderUseCase,
    private readonly applyActions: OrganizeApplyActions,
    private readonly configPort: ConfigPort,
    private readonly historyPort: HistoryPort,
    private readonly vault: VaultAccessPort,
    private readonly openFile: (path: string) => void,
    private readonly onProcessingStateChange: (isProcessing: boolean) => void,
  ) {
    super(leaf);
  }

  getViewType(): string { return ORGANIZE_FOLDER_VIEW_TYPE; }
  getDisplayText(): string { return t('organizeFolder.viewTitle'); }
  getIcon(): string { return 'wand'; }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on(HISTORY_CHANGED_EVENT, (undoneId?: string) =>
        this.onHistoryChanged(undoneId)),
    );
    this.renderEmpty();
  }

  private onHistoryChanged(undoneId?: string): void {
    if (!undoneId || this.entries.length === 0) return;
    const entry = this.entries.find(e => e.historyEntryId === undoneId);
    if (!entry || entry.status !== 'applied') return;
    entry.status = 'pending';
    entry.historyEntryId = undefined;

    entry.container.removeClass('organize-folder-entry-applied');
    if (!this.autoApplyMode) {
      entry.checkbox.removeClass('vaultend-hidden');
    }
    const undoBtn = entry.setting.controlEl.querySelector('.mod-warning');
    if (undoBtn) undoBtn.remove();
    if (!this.autoApplyMode) {
      entry.setting.addButton(btn =>
        btn.setButtonText(t('organizeFolder.applyNote'))
          .setCta()
          .onClick(() => this.applyEntry(entry)),
      );
    }
    entry.setting.setDesc(entry.result.notePath as string);
  }

  async onClose(): Promise<void> {
    this.abortController?.abort();
    this.contentEl.empty();
  }

  isScanInProgress(): boolean { return this.scanInProgress; }

  private renderEmpty(): void {
    this.contentEl.empty();
    const header = this.contentEl.createEl('h4', { text: t('organizeFolder.viewTitle') });
    header.addClass('organize-folder-header');

    new Setting(this.contentEl)
      .setName(t('organizeFolder.selectFolder'))
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.startScan'))
          .setCta()
          .onClick(() => this.promptFolderAndScan()),
      );
  }

  private promptFolderAndScan(): void {
    const { FuzzySuggestModal, TFolder } = require('obsidian');
    const modal = new (class extends FuzzySuggestModal<typeof TFolder> {
      constructor(private view: OrganizeFolderResultView) {
        super(view.app);
        this.setPlaceholder(t('organizeFolder.placeholder'));
      }
      getItems(): (typeof TFolder)[] {
        const folders: (typeof TFolder)[] = [];
        const collect = (folder: typeof TFolder) => {
          folders.push(folder);
          for (const child of folder.children ?? []) {
            if (child instanceof TFolder) collect(child);
          }
        };
        collect(this.view.app.vault.getRoot());
        return folders;
      }
      getItemText(folder: typeof TFolder): string {
        return folder.path || '/ (Vault Root)';
      }
      onChooseItem(folder: typeof TFolder): void {
        this.view.triggerScan(folder.path);
      }
    })(this);
    modal.open();
  }

  async triggerScan(folderPath: string): Promise<void> {
    if (this.scanInProgress) return;
    this.scanInProgress = true;
    this.targetFolder = folderPath;
    this.entries = [];
    this.currentResult = null;
    this.onProcessingStateChange(true);

    const settings = await this.configPort.getSettings();
    this.autoApplyMode = settings.autoApplyOrganize;

    this.abortController = new AbortController();
    this.renderProgress(folderPath, 0, 0, '');

    try {
      const result = await this.organizeFolderUseCase.execute({
        folder: folderPath,
        signal: this.abortController.signal,
        onProgress: (info) => {
          this.renderProgress(folderPath, info.current, info.total, info.currentNotePath as string);
        },
      });
      this.currentResult = result;
      this.scanInProgress = false;
      this.onProcessingStateChange(false);
      this.render();
    } catch (err) {
      this.scanInProgress = false;
      this.onProcessingStateChange(false);
      this.renderError(err);
    }
  }

  private renderProgress(folder: string, current: number, total: number, currentNote: string): void {
    this.contentEl.empty();
    const displayFolder = folder || '/';

    this.contentEl.createEl('h4', { text: `${t('organizeFolder.viewTitle')}: ${displayFolder}/` });

    const status = this.contentEl.createDiv({ cls: 'organize-folder-progress' });
    status.createEl('p', { text: t('organizeFolder.scanning'), cls: 'organize-folder-scanning' });

    if (total > 0) {
      const basename = currentNote.split('/').pop()?.replace('.md', '') ?? '';
      status.createEl('p', { text: basename, cls: 'organize-folder-current-note' });
      status.createEl('p', { text: `${current} / ${total}`, cls: 'organize-folder-counter' });

      const barContainer = status.createDiv({ cls: 'inbox-progress-bar-container' });
      const barFill = barContainer.createDiv({ cls: 'inbox-progress-bar-fill' });
      barFill.style.width = `${Math.round((current / total) * 100)}%`;
    }

    const actions = this.contentEl.createDiv({ cls: 'organize-folder-actions' });
    new Setting(actions)
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.cancel'))
          .setWarning()
          .onClick(() => this.abortController?.abort()),
      );
  }

  private renderError(err: unknown): void {
    this.contentEl.empty();
    this.contentEl.createEl('h4', { text: t('organizeFolder.viewTitle') });
    this.contentEl.createEl('p', {
      text: t('organizeFolder.scanFailed', { error: localizeError(err) }),
      cls: 'organize-folder-error',
    });
    new Setting(this.contentEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.startScan'))
          .setCta()
          .onClick(() => this.promptFolderAndScan()),
      );
  }

  private render(): void {
    this.contentEl.empty();
    this.entries = [];

    const result = this.currentResult;
    if (!result) { this.renderEmpty(); return; }

    const displayFolder = this.targetFolder || '/';
    this.contentEl.createEl('h4', { text: `${t('organizeFolder.viewTitle')}: ${displayFolder}/` });

    // Rescan button
    new Setting(this.contentEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.rescan'))
          .onClick(() => {
            if (this.targetFolder !== null) this.triggerScan(this.targetFolder);
          }),
      );

    // Summary
    const summaryEl = this.contentEl.createDiv({ cls: 'organize-folder-summary' });
    summaryEl.createEl('span', {
      text: t('organizeFolder.summary', {
        processed: String(result.processedCount),
        skipped: String(result.skippedCount),
        errors: String(result.errors.length),
      }),
    });

    // Token total
    if (result.results.length > 0) {
      const totalTokens = result.results.reduce((sum, r) => sum + r.tokenUsage.totalTokens, 0);
      const totalCost = result.results.reduce((sum, r) => sum + r.tokenUsage.estimatedCostUsd, 0);
      const hasCostData = totalCost >= 0;
      summaryEl.createEl('span', {
        text: hasCostData
          ? t('organizeFolder.tokenTotal', { count: totalTokens.toLocaleString(), cost: totalCost.toFixed(4) })
          : t('organizeFolder.tokenTotalUnavailable' as any, { count: totalTokens.toLocaleString() }),
        cls: 'organize-folder-token-info',
      });
    }

    // Errors
    if (result.errors.length > 0) {
      const errorDiv = this.contentEl.createDiv({ cls: 'organize-folder-error-list' });
      const ul = errorDiv.createEl('ul');
      for (const err of result.errors) {
        ul.createEl('li', { text: `${err.path as string}: ${err.error}` });
      }
    }

    // No results
    if (result.results.length === 0) {
      this.contentEl.createEl('p', {
        text: t('organizeFolder.noResults'),
        cls: 'organize-folder-empty',
      });
      return;
    }

    // Batch controls (only in review mode)
    if (!this.autoApplyMode) {
      this.renderBatchControls();
    }

    // Per-note entries
    const entriesContainer = this.contentEl.createDiv({ cls: 'organize-folder-entries' });
    for (const noteResult of result.results) {
      this.renderNoteEntry(entriesContainer, noteResult);
    }
  }

  private renderBatchControls(): void {
    const batchEl = this.contentEl.createDiv({ cls: 'organize-folder-batch-controls' });

    const selectAllContainer = batchEl.createDiv({ cls: 'maintenance-batch-checkbox' });
    const selectAllCheckbox = selectAllContainer.createEl('input', { type: 'checkbox' });
    selectAllContainer.createEl('span', { text: t('batch.selectAll') });
    selectAllCheckbox.addEventListener('change', () => {
      for (const entry of this.entries) {
        if (entry.status === 'pending') {
          entry.checkbox.checked = selectAllCheckbox.checked;
        }
      }
    });

    new Setting(batchEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.applySelected'))
          .setCta()
          .onClick(() => this.applyBatch()),
      )
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.skipSelected'))
          .onClick(() => this.skipBatch()),
      );
  }

  private renderNoteEntry(container: HTMLElement, result: OrganizeResult): void {
    const notePath = result.notePath;
    const pathStr = notePath as string;
    const basename = pathStr.split('/').pop()?.replace('.md', '') ?? pathStr;

    const entryContainer = container.createDiv({ cls: 'organize-folder-entry' });

    const hasChanges = result.addedTags.length > 0
      || result.suggestedLinks.length > 0
      || result.suggestedMoveTarget;

    const setting = new Setting(entryContainer);
    setting.setName(basename);
    setting.setDesc(pathStr);

    // Checkbox (review mode only, entries with changes)
    let checkbox: HTMLInputElement;
    if (!this.autoApplyMode && hasChanges) {
      const checkboxEl = createEl('input', { type: 'checkbox' });
      checkboxEl.addClass('maintenance-batch-checkbox');
      setting.settingEl.prepend(checkboxEl);
      checkbox = checkboxEl;
    } else {
      checkbox = createEl('input', { type: 'checkbox' });
      checkbox.addClass('vaultend-hidden');
    }

    // Open button — uses currentPath after move
    setting.addButton(btn =>
      btn.setButtonText(t('btn.open'))
        .onClick(() => {
          const openPath = entry?.currentPath ?? pathStr;
          this.openFile(openPath);
        }),
    );

    const entry: OrganizeFolderEntry = {
      result,
      checkbox,
      setting,
      status: this.autoApplyMode && result.historyEntryId ? 'applied' : 'pending',
      historyEntryId: result.historyEntryId,
      selectedTags: result.addedTags.map(tag => tag as string),
      selectedLinks: [...result.suggestedLinks],
      selectedFolder: result.suggestedMoveTarget,
      container: entryContainer,
    };
    this.entries.push(entry);

    // Category badge
    const detailsEl = entryContainer.createDiv({ cls: 'organize-folder-note-details' });
    detailsEl.createEl('span', {
      text: result.classifiedCategory,
      cls: 'organize-folder-category-badge',
    });
    if (result.lowConfidence) {
      detailsEl.createEl('span', {
        text: t('organizeFolder.lowConfidence'),
        cls: 'organize-folder-low-confidence',
      });
    }

    // Summary
    if (result.summary) {
      detailsEl.createEl('p', { text: result.summary, cls: 'organize-folder-summary-text' });
    }

    // Per-note token usage
    if (result.tokenUsage.totalTokens > 0) {
      const costAvailable = result.tokenUsage.estimatedCostUsd >= 0;
      detailsEl.createEl('span', {
        text: costAvailable
          ? t('organizeFolder.tokenNote' as Parameters<typeof t>[0], {
              count: result.tokenUsage.totalTokens,
              cost: result.tokenUsage.estimatedCostUsd.toFixed(4),
            })
          : t('organizeFolder.tokenNoteUnavailable' as any, {
              count: result.tokenUsage.totalTokens,
            }),
        cls: 'organize-folder-token-note',
      });
    }

    if (!hasChanges) {
      detailsEl.createEl('p', {
        text: t('organizeFolder.noChanges'),
        cls: 'organize-folder-no-changes',
      });
    }

    // Tags section
    if (result.addedTags.length > 0) {
      this.renderTagSection(detailsEl, entry);
    }

    // Links section
    if (result.suggestedLinks.length > 0) {
      this.renderLinkSection(detailsEl, entry);
    }

    // Move section (always shown — "keep current" when no move suggested)
    this.renderMoveSection(detailsEl, entry);

    // Action buttons
    if (entry.status === 'applied') {
      this.markEntryApplied(entry);
    } else if (hasChanges && !this.autoApplyMode) {
      setting.addButton(btn =>
        btn.setButtonText(t('organizeFolder.applyNote'))
          .setCta()
          .onClick(() => this.applyEntry(entry)),
      );
    }
  }

  private renderTagSection(container: HTMLElement, entry: OrganizeFolderEntry): void {
    const section = container.createDiv({ cls: 'organize-folder-section' });
    section.createEl('span', { text: t('organizeFolder.tagsSection'), cls: 'organize-folder-section-label' });
    const chipList = section.createDiv({ cls: 'organize-tag-list' });

    for (const tag of entry.selectedTags) {
      const chip = chipList.createEl('span', { text: tag, cls: 'organize-chip' });
      if (entry.status === 'pending' && !this.autoApplyMode) {
        const removeBtn = chip.createEl('span', { text: '×', cls: 'organize-chip-remove' });
        removeBtn.addEventListener('click', () => {
          entry.selectedTags = entry.selectedTags.filter(t => t !== tag);
          chip.remove();
        });
      }
    }
  }

  private renderLinkSection(container: HTMLElement, entry: OrganizeFolderEntry): void {
    const section = container.createDiv({ cls: 'organize-folder-section' });
    section.createEl('span', { text: t('organizeFolder.linksSection'), cls: 'organize-folder-section-label' });
    const chipList = section.createDiv({ cls: 'organize-link-list' });

    for (const link of entry.selectedLinks) {
      const linkPath = (link as string).replace('.md', '');
      const chip = chipList.createEl('span', { text: `[[${linkPath}]]`, cls: 'organize-chip' });
      if (entry.status === 'pending' && !this.autoApplyMode) {
        const removeBtn = chip.createEl('span', { text: '×', cls: 'organize-chip-remove' });
        removeBtn.addEventListener('click', () => {
          entry.selectedLinks = entry.selectedLinks.filter(l => l !== link);
          chip.remove();
        });
      }
    }
  }

  private renderMoveSection(container: HTMLElement, entry: OrganizeFolderEntry): void {
    const section = container.createDiv({ cls: 'organize-folder-section' });
    section.createEl('span', { text: t('organizeFolder.moveSection'), cls: 'organize-folder-section-label' });

    if (!entry.result.suggestedMoveTarget) {
      section.createEl('span', {
        text: t('organize.keepCurrent'),
        cls: 'organize-folder-keep-current',
      });
    } else if (entry.status === 'pending' && !this.autoApplyMode) {
      section.createEl('span', {
        text: `→ ${entry.selectedFolder}/`,
        cls: 'organize-folder-move-target',
      });
    } else {
      section.createEl('span', {
        text: `→ ${entry.result.suggestedMoveTarget}/`,
        cls: 'organize-folder-move-target',
      });
    }

    if (entry.result.folderReason) {
      section.createEl('span', {
        text: t('organizeFolder.folderReason', { reason: entry.result.folderReason }),
        cls: 'organize-folder-reason',
      });
    }
  }

  private async applyEntry(entry: OrganizeFolderEntry): Promise<boolean> {
    if (entry.status !== 'pending') return false;

    try {
      const note = await this.vault.readNote(entry.result.notePath);
      const previousContent = note?.content ?? '';

      const entryId = crypto.randomUUID();
      await this.historyPort.record({
        id: entryId,
        action: 'classify',
        notePath: entry.result.notePath,
        timestamp: createTimestamp(Date.now()),
        description: `Organized: folder=${entry.selectedFolder ?? 'keep'}, tags=${entry.selectedTags.length}`,
        previousContent,
        metadata: {
          tags: entry.selectedTags,
          links: entry.selectedLinks.map(l => l as string),
          moveTarget: entry.selectedFolder,
        },
      });

      if (entry.selectedTags.length > 0) {
        await this.applyActions.applyTags(entry.result.notePath, entry.selectedTags);
      }
      if (entry.selectedLinks.length > 0) {
        await this.applyActions.addLinks(entry.result.notePath, entry.selectedLinks);
      }
      if (entry.selectedFolder) {
        await this.applyActions.moveNote(entry.result.notePath, entry.selectedFolder);
        entry.currentPath = `${entry.selectedFolder}/${(entry.result.notePath as string).split('/').pop() ?? ''}`;
      }

      // Mark as processed
      const currentNotePath = entry.currentPath ?? (entry.result.notePath as string);
      const stillExists = await this.vault.exists(currentNotePath as unknown as NotePath);
      if (stillExists) {
        await this.vault.updateFrontmatter(currentNotePath as unknown as NotePath, { processed: true });
      }

      entry.status = 'applied';
      entry.historyEntryId = entryId;
      this.markEntryApplied(entry);
      new Notice(t('notice.actionApplied'));
      this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
      return true;
    } catch (err) {
      new Notice(t('notice.actionFailed', { error: localizeError(err) }));
      return false;
    }
  }

  private markEntryApplied(entry: OrganizeFolderEntry): void {
    entry.container.addClass('organize-folder-entry-applied');
    entry.checkbox.addClass('vaultend-hidden');

    // Remove action buttons except Open, add Undo
    const controlEl = entry.setting.controlEl;
    const buttons = controlEl.querySelectorAll('.mod-cta');
    buttons.forEach(btn => btn.remove());

    if (entry.historyEntryId) {
      entry.setting.addButton(btn =>
        btn.setButtonText(t('organizeFolder.undoNote'))
          .setWarning()
          .onClick(() => this.undoEntry(entry)),
      );
    }

    entry.setting.setDesc(t('organizeFolder.applied'));
  }

  private async undoEntry(entry: OrganizeFolderEntry): Promise<void> {
    if (!entry.historyEntryId) return;
    const undoneId = entry.historyEntryId;
    try {
      await this.historyPort.undo(undoneId);
      entry.status = 'pending';
      entry.historyEntryId = undefined;

      entry.container.removeClass('organize-folder-entry-applied');
      if (!this.autoApplyMode) {
        entry.checkbox.removeClass('vaultend-hidden');
      }

      const controlEl = entry.setting.controlEl;
      const undoBtn = controlEl.querySelector('.mod-warning');
      if (undoBtn) undoBtn.remove();

      entry.setting.setDesc(entry.result.notePath as string);
      new Notice(t('undo.success'));
      this.app.workspace.trigger(HISTORY_CHANGED_EVENT, undoneId);
    } catch (err) {
      new Notice(t('undo.failed', { error: localizeError(err) }));
    }
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
      if (ok) {
        success++;
      } else {
        failed++;
      }
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
      entry.status = 'skipped';
      entry.container.addClass('organize-folder-entry-applied');
      entry.checkbox.addClass('vaultend-hidden');
      entry.setting.setDesc(t('organizeFolder.skipped'));
      const buttons = entry.setting.controlEl.querySelectorAll('.mod-cta');
      buttons.forEach(btn => btn.remove());
    }
    new Notice(t('notice.batchComplete', { count: String(selected.length) }));
  }
}
