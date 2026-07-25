import { ButtonComponent, FuzzySuggestModal, ItemView, Notice, setIcon, Setting, TextComponent, TFolder, WorkspaceLeaf } from 'obsidian';
import { OrganizeFolderUseCase, OrganizeFolderResult } from '../application/usecases/RunInboxProcessUseCase';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { OrganizeApplyActions } from './OrganizeResultModal';
import { ConfigPort } from '../application/ports/ConfigPort';
import { HistoryPort } from '../application/ports/HistoryPort';
import { VaultAccessPort } from '../application/ports/VaultAccessPort';
import type { OrganizeHashPort } from '../application/ports/OrganizeHashPort';
import { NotePath } from '../domain/values/NotePath';
import { createTimestamp } from '../domain/values/Timestamp';
import { ORGANIZE_FOLDER_VIEW_TYPE, HISTORY_CHANGED_EVENT } from '../constants';
import { NoteEmbeddingService } from '../domain/services/NoteEmbeddingService';
import { stripFrontmatter } from '../domain/services/tokenize';
import { stripRelatedNotesSection } from '../application/utils/relatedNotesSection';
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
  container: HTMLElement;
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
    private readonly organizeHash?: OrganizeHashPort,
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
    const undoBtn = entry.setting.controlEl.querySelector('.mod-warning');
    if (undoBtn) undoBtn.remove();
    if (!this.autoApplyMode) {
      entry.setting.addButton(btn =>
        btn.setButtonText(t('organizeFolder.applyNote'))
          .setCta()
          .onClick(() => { void this.applyEntry(entry); }),
      );
    }
    entry.setting.setDesc(entry.result.notePath);
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
    const modal = new (class extends FuzzySuggestModal<TFolder> {
      constructor(private view: OrganizeFolderResultView) {
        super(view.app);
        this.setPlaceholder(t('organizeFolder.placeholder'));
      }
      getItems(): TFolder[] {
        const folders: TFolder[] = [];
        const collect = (folder: TFolder) => {
          folders.push(folder);
          for (const child of folder.children ?? []) {
            if (child instanceof TFolder) collect(child);
          }
        };
        collect(this.view.app.vault.getRoot());
        return folders;
      }
      getItemText(folder: TFolder): string {
        return folder.path || '/ (Vault Root)';
      }
      onChooseItem(folder: TFolder): void {
        void this.view.triggerScan(folder.path);
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
          this.renderProgress(folderPath, info.current, info.total, info.currentNotePath);
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

    // Rescan / Continue button + guidance
    const actionSetting = new Setting(this.contentEl)
      .setDesc(t('organizeFolder.noChangesHint'))
      .addButton(btn =>
        btn.setButtonText(t('organizeFolder.rescan'))
          .onClick(() => {
            if (this.targetFolder !== null) void this.triggerScan(this.targetFolder);
          }),
      );

    if (result.remainingCount > 0) {
      actionSetting.addButton(btn =>
        btn.setButtonText(t('organizeFolder.continue', { remaining: String(result.remainingCount) }))
          .setCta()
          .onClick(() => {
            if (this.targetFolder !== null) void this.triggerScan(this.targetFolder);
          }),
      );
    }

    // Summary
    const summaryEl = this.contentEl.createDiv({ cls: 'organize-folder-summary' });
    summaryEl.createSpan({
      text: result.remainingCount > 0
        ? t('organizeFolder.batchSummary', {
            processed: String(result.processedCount),
            remaining: String(result.remainingCount),
            skipped: String(result.skippedCount),
            errors: String(result.errors.length),
          })
        : t('organizeFolder.summary', {
            processed: String(result.processedCount),
            skipped: String(result.skippedCount),
            errors: String(result.errors.length),
          }),
    });

    // Skip breakdown (only if there are smart-filtered notes)
    if (result.skipBreakdown) {
      const { tooShort, alreadyLinked, alreadyOrganized } = result.skipBreakdown;
      const smartSkipped = tooShort + alreadyLinked + alreadyOrganized;
      if (smartSkipped > 0) {
        summaryEl.createSpan({
          text: t('organizeFolder.skipDetail', {
            tooShort: String(tooShort),
            alreadyLinked: String(alreadyLinked),
            alreadyOrganized: String(alreadyOrganized),
          }),
          cls: 'organize-folder-skip-detail',
        });
      }
    }

    // Token total (LLM tokens only — excludes embedding API tokens)
    if (result.results.length > 0) {
      let totalTokens = result.results.reduce((sum, r) => sum + r.tokenUsage.totalTokens, 0);
      let totalCost = result.results.reduce((sum, r) => sum + r.tokenUsage.estimatedCostUsd, 0);
      if (result.linkSelectionTokenUsage) {
        totalTokens += result.linkSelectionTokenUsage.totalTokens;
        totalCost += result.linkSelectionTokenUsage.estimatedCostUsd;
      }
      const hasCostData = totalCost >= 0;
      summaryEl.createSpan({
        text: hasCostData
          ? t('organizeFolder.tokenTotal', { count: totalTokens.toLocaleString(), cost: totalCost.toFixed(4) })
          : t('organizeFolder.tokenTotalUnavailable', { count: totalTokens.toLocaleString() }),
        cls: 'organize-folder-token-info',
      });
    }

    // Errors
    if (result.errors.length > 0) {
      const errorDiv = this.contentEl.createDiv({ cls: 'organize-folder-error-list' });
      const ul = errorDiv.createEl('ul');
      for (const err of result.errors) {
        ul.createEl('li', { text: `${err.path}: ${err.error}` });
      }
    }

    // No results
    if (result.results.length === 0) {
      const emptyEl = this.contentEl.createDiv({ cls: 'vaultend-empty-state' });
      const iconEl = emptyEl.createSpan({ cls: 'vaultend-empty-state-icon' });
      setIcon(iconEl, 'folder-open');
      emptyEl.createSpan({ text: t('organizeFolder.noResults') });
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
    selectAllContainer.createSpan({ text: t('batch.selectAll') });
    selectAllCheckbox.addEventListener('change', () => {
      for (const entry of this.entries) {
        if (entry.status === 'pending' || entry.status === 'applied') {
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
      )
      .addButton(btn =>
        btn.setButtonText(t('batch.selectedUndo'))
          .setWarning()
          .onClick(() => this.undoBatch()),
      );
  }

  private renderNoteEntry(container: HTMLElement, result: OrganizeResult): void {
    const notePath = result.notePath;
    const pathStr = notePath;
    const basename = pathStr.split('/').pop()?.replace('.md', '') ?? pathStr;

    const entryContainer = container.createDiv({ cls: 'organize-folder-entry' });

    const hasChanges = result.addedTags.length > 0
      || result.suggestedLinks.length > 0;

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

    setting.addButton(btn =>
      btn.setButtonText(t('btn.open'))
        .onClick(() => this.openFile(pathStr)),
    );

    const entry: OrganizeFolderEntry = {
      result,
      checkbox,
      setting,
      status: this.autoApplyMode && result.historyEntryId ? 'applied' : 'pending',
      historyEntryId: result.historyEntryId,
      selectedTags: [...result.addedTags],
      selectedLinks: [...result.suggestedLinks],
      container: entryContainer,
    };
    this.entries.push(entry);

    const detailsEl = entryContainer.createDiv({ cls: 'organize-folder-note-details' });
    if (result.lowConfidence) {
      detailsEl.createSpan({
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
      detailsEl.createSpan({
        text: costAvailable
          ? t('organizeFolder.tokenNote', {
              count: result.tokenUsage.totalTokens,
              cost: result.tokenUsage.estimatedCostUsd.toFixed(4),
            })
          : t('organizeFolder.tokenNoteUnavailable', {
              count: result.tokenUsage.totalTokens,
            }),
        cls: 'organize-folder-token-note',
      });
    }

    if (!hasChanges) {
      const emptyEl = detailsEl.createDiv({ cls: 'vaultend-empty-state' });
      const iconEl = emptyEl.createSpan({ cls: 'vaultend-empty-state-icon' });
      setIcon(iconEl, 'check-circle');
      emptyEl.createSpan({ text: t('organizeFolder.noChanges') });
    }

    // Tags section — always render in review mode so users can manually add tags
    if (result.addedTags.length > 0 || (!this.autoApplyMode && entry.status === 'pending')) {
      this.renderTagSection(detailsEl, entry);
    }

    // Links section — always render in review mode so users can manually add links
    if (result.suggestedLinks.length > 0 || (!this.autoApplyMode && entry.status === 'pending')) {
      this.renderLinkSection(detailsEl, entry);
    }

    // Action buttons
    if (entry.status === 'applied') {
      this.markEntryApplied(entry);
    } else if (hasChanges && !this.autoApplyMode) {
      setting.addButton(btn =>
        btn.setButtonText(t('organizeFolder.applyNote'))
          .setCta()
          .onClick(() => { void this.applyEntry(entry); }),
      );
    }
  }

  private renderTagSection(container: HTMLElement, entry: OrganizeFolderEntry): void {
    const section = container.createDiv({ cls: 'organize-folder-section' });
    section.createSpan({ text: t('organizeFolder.tagsSection'), cls: 'organize-folder-section-label' });
    const chipList = section.createDiv({ cls: 'organize-tag-list' });

    this.rebuildFolderTagChips(chipList, entry);

    if (entry.status === 'pending' && !this.autoApplyMode) {
      const addRow = section.createDiv({ cls: 'organize-add-row' });
      const input = new TextComponent(addRow);
      input.setPlaceholder(t('organize.addTagPlaceholder'));
      input.inputEl.addClass('organize-add-input');
      input.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.addTagToEntry(input, chipList, entry);
        }
      });
      new ButtonComponent(addRow)
        .setButtonText(t('organize.addBtn'))
        .onClick(() => this.addTagToEntry(input, chipList, entry));
    }
  }

  private rebuildFolderTagChips(chipList: HTMLElement, entry: OrganizeFolderEntry): void {
    chipList.empty();
    for (const tag of entry.selectedTags) {
      const reason = entry.result.tagReasons?.get(tag) ?? entry.result.tagReasons?.get(`#${tag}`);
      const chipClasses = ['organize-chip'];
      if (reason?.isNew) chipClasses.push('organize-chip-new');

      const chip = chipList.createSpan({ cls: chipClasses.join(' ') });
      if (reason?.reason) {
        chip.setAttribute('title', reason.reason);
      }
      chip.createSpan({ text: tag });
      if (reason) {
        chip.createSpan({
          text: String(reason.score),
          cls: 'organize-chip-score',
        });
      }
      if (entry.status === 'pending' && !this.autoApplyMode) {
        const removeBtn = chip.createSpan({ text: '×', cls: 'organize-chip-remove' });
        removeBtn.setAttribute('tabindex', '0');
        removeBtn.setAttribute('role', 'button');
        removeBtn.setAttribute('aria-label', t('organize.removeTag'));
        removeBtn.addEventListener('click', () => {
          entry.selectedTags = entry.selectedTags.filter(t2 => t2 !== tag);
          this.rebuildFolderTagChips(chipList, entry);
        });
        removeBtn.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            removeBtn.click();
          }
        });
      }
    }
  }

  private addTagToEntry(input: TextComponent, chipList: HTMLElement, entry: OrganizeFolderEntry): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw.slice(1) : raw;
    if (tag && !entry.selectedTags.includes(tag)) {
      entry.selectedTags.push(tag);
      this.rebuildFolderTagChips(chipList, entry);
    }
    input.setValue('');
  }

  private renderLinkSection(container: HTMLElement, entry: OrganizeFolderEntry): void {
    const section = container.createDiv({ cls: 'organize-folder-section' });
    section.createSpan({ text: t('organizeFolder.linksSection'), cls: 'organize-folder-section-label' });
    const chipList = section.createDiv({ cls: 'organize-link-list' });

    this.rebuildFolderLinkChips(chipList, entry);

    if (entry.status === 'pending' && !this.autoApplyMode) {
      const addRow = section.createDiv({ cls: 'organize-add-row' });
      const input = new TextComponent(addRow);
      input.setPlaceholder(t('organize.addLinkPlaceholder'));
      input.inputEl.addClass('organize-add-input');
      input.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.addLinkToEntry(input, chipList, entry);
        }
      });
      new ButtonComponent(addRow)
        .setButtonText(t('organize.addBtn'))
        .onClick(() => this.addLinkToEntry(input, chipList, entry));
    }
  }

  private rebuildFolderLinkChips(chipList: HTMLElement, entry: OrganizeFolderEntry): void {
    chipList.empty();
    for (const link of entry.selectedLinks) {
      const linkPath = link.replace('.md', '');
      const chip = chipList.createSpan({ text: `[[${linkPath}]]`, cls: 'organize-chip' });
      if (entry.status === 'pending' && !this.autoApplyMode) {
        const removeBtn = chip.createSpan({ text: '×', cls: 'organize-chip-remove' });
        removeBtn.setAttribute('tabindex', '0');
        removeBtn.setAttribute('role', 'button');
        removeBtn.setAttribute('aria-label', t('organize.removeLink'));
        removeBtn.addEventListener('click', () => {
          entry.selectedLinks = entry.selectedLinks.filter(l => l !== link);
          this.rebuildFolderLinkChips(chipList, entry);
        });
        removeBtn.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            removeBtn.click();
          }
        });
      }
    }
  }

  private addLinkToEntry(input: TextComponent, chipList: HTMLElement, entry: OrganizeFolderEntry): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const cleaned = raw.replace(/^\[\[/, '').replace(/\]\]$/, '');
    const path = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
    const asNotePath = path as unknown as NotePath;
    if (!entry.selectedLinks.some(l => l === path)) {
      entry.selectedLinks.push(asNotePath);
      this.rebuildFolderLinkChips(chipList, entry);
    }
    input.setValue('');
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
        description: `Organized: tags=${entry.selectedTags.length}, links=${entry.selectedLinks.length}`,
        previousContent,
        metadata: {
          tags: entry.selectedTags,
          links: [...entry.selectedLinks],
        },
      });

      if (entry.selectedTags.length > 0) {
        await this.applyActions.applyTags(entry.result.notePath, entry.selectedTags);
      }
      if (entry.selectedLinks.length > 0) {
        await this.applyActions.addLinks(entry.result.notePath, entry.selectedLinks);
      }
      if (this.organizeHash) {
        const stillExists = await this.vault.exists(entry.result.notePath);
        if (stillExists) {
          const applied = await this.vault.readNote(entry.result.notePath);
          if (applied) {
            const hashBody = stripFrontmatter(stripRelatedNotesSection(applied.content));
            const hash = await NoteEmbeddingService.computeContentHash('', hashBody);
            await this.organizeHash.setHash(entry.result.notePath, hash);
            await this.organizeHash.persist();
          }
        }
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
    entry.checkbox.checked = false;

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

  private async undoEntry(entry: OrganizeFolderEntry): Promise<boolean> {
    if (!entry.historyEntryId) return false;
    const undoneId = entry.historyEntryId;
    try {
      await this.historyPort.undo(undoneId);
      entry.status = 'pending';
      entry.historyEntryId = undefined;

      entry.container.removeClass('organize-folder-entry-applied');

      const controlEl = entry.setting.controlEl;
      const undoBtn = controlEl.querySelector('.mod-warning');
      if (undoBtn) undoBtn.remove();

      if (!this.autoApplyMode) {
        entry.setting.addButton(btn =>
          btn.setButtonText(t('organizeFolder.applyNote'))
            .setCta()
            .onClick(() => { void this.applyEntry(entry); }),
        );
      }

      entry.setting.setDesc(entry.result.notePath);
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
