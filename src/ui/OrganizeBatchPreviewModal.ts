import { App, ButtonComponent, Modal, Notice, setIcon, TextComponent } from 'obsidian';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { NotePath, createNotePath } from '../domain/values/NotePath';
import type { OrganizeApplyActions } from './OrganizeResultModal';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export interface BatchPreviewItem {
  readonly notePath: NotePath;
  readonly result: OrganizeResult;
}

export interface BatchAppliedEntry {
  readonly notePath: NotePath;
  readonly historyEntryId: string;
}

export interface BatchOrganizeCallbacks {
  readonly actions: OrganizeApplyActions;
  readonly readContent: (path: NotePath) => Promise<string>;
  readonly writeContent: (path: NotePath, content: string) => Promise<void>;
  readonly recordHistory: (id: string, notePath: NotePath, previousContent: string, description: string, tags: string[], links: string[]) => Promise<void>;
}

interface TagEntry {
  name: string;
  enabled: boolean;
}

interface LinkEntry {
  path: string;
  enabled: boolean;
}

interface EditableItem {
  readonly notePath: NotePath;
  tags: TagEntry[];
  links: LinkEntry[];
}

export class OrganizeBatchPreviewModal extends Modal {
  private onApplied?: (entries: ReadonlyArray<BatchAppliedEntry>) => void;
  private editableItems: EditableItem[];
  private activeReorgCount = 0;
  private applyAllBtn?: ButtonComponent;

  constructor(
    app: App,
    private readonly items: ReadonlyArray<BatchPreviewItem>,
    private readonly callbacks: BatchOrganizeCallbacks,
    private readonly tagsOnly: boolean = false,
    private readonly onReorganizeNote?: (notePath: NotePath) => Promise<OrganizeResult>,
  ) {
    super(app);
    this.editableItems = items.map(item => ({
      notePath: item.notePath,
      tags: item.result.addedTags.map(tag => ({ name: tag, enabled: true })),
      links: item.result.suggestedLinks.map(link => ({ path: link, enabled: true })),
    }));
  }

  setOnApplied(cb: (entries: ReadonlyArray<BatchAppliedEntry>) => void): this {
    this.onApplied = cb;
    return this;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-organize-batch-preview');

    contentEl.createEl('h2', { text: t('organize.batchPreviewTitle') });
    contentEl.createEl('p', {
      text: t('organize.batchPreviewDesc', { count: this.items.length }),
      cls: 'organize-batch-desc',
    });

    const list = contentEl.createDiv('organize-batch-list');
    for (const editable of this.editableItems) {
      this.renderItem(list, editable);
    }

    this.renderFooter(contentEl);
  }

  private renderItem(container: HTMLElement, editable: EditableItem): void {
    const card = container.createDiv('organize-batch-card');
    this.renderItemContent(card, editable);
  }

  private renderItemContent(card: HTMLElement, editable: EditableItem): void {
    const noteName = editable.notePath.split('/').pop()?.replace('.md', '') ?? '';
    const header = card.createDiv({ cls: 'organize-batch-card-header' });
    header.createDiv({ text: noteName, cls: 'organize-batch-card-name' });

    if (this.onReorganizeNote) {
      const reorgBtn = header.createSpan({
        cls: 'organize-batch-reorg-btn',
        attr: {
          'aria-label': t('organize.reorganize'),
          'title': t('organize.reorganize'),
          'tabindex': '0',
          'role': 'button',
        },
      });
      setIcon(reorgBtn, 'refresh-cw');
      reorgBtn.createSpan({ text: t('organize.reorganize'), cls: 'organize-batch-reorg-label' });
      reorgBtn.addEventListener('click', () => { void this.reorganizeItem(card, editable); });
      reorgBtn.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          reorgBtn.click();
        }
      });
    }

    const details = card.createDiv('organize-batch-card-details');

    this.renderEditableTags(details, editable);

    if (!this.tagsOnly) {
      this.renderEditableLinks(details, editable);
    }

    if (editable.tags.length === 0 && (this.tagsOnly || editable.links.length === 0)) {
      const emptyEl = details.createDiv({ cls: 'vaultend-empty-state' });
      const iconEl = emptyEl.createSpan({ cls: 'vaultend-empty-state-icon' });
      setIcon(iconEl, 'check-circle');
      emptyEl.createSpan({ text: t('organize.noChanges') });
    }

    const item = this.items.find(i => i.notePath === editable.notePath);
    if (item && item.result.tokenUsage.totalTokens > 0) {
      const costAvailable = item.result.tokenUsage.estimatedCostUsd >= 0;
      const text = costAvailable
        ? t('organizeFolder.tokenNote', {
            count: item.result.tokenUsage.totalTokens,
            cost: item.result.tokenUsage.estimatedCostUsd.toFixed(4),
          })
        : t('organizeFolder.tokenNoteUnavailable', {
            count: item.result.tokenUsage.totalTokens,
          });
      card.createDiv({ text, cls: 'organize-batch-token-info' });
    }
  }

  private renderEditableTags(container: HTMLElement, editable: EditableItem): void {
    const tagLine = container.createDiv('organize-batch-tags');
    tagLine.createSpan({ text: t('organize.tagsLabel'), cls: 'organize-batch-label' });
    const chipContainer = tagLine.createDiv('organize-batch-tag-chips');
    this.renderTagChips(chipContainer, editable);

    const addRow = tagLine.createDiv('organize-tag-add-row');
    const inputEl = new TextComponent(addRow)
      .setPlaceholder(t('organize.addTagPlaceholder'));
    inputEl.inputEl.addClass('organize-tag-input');

    inputEl.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addTagToEditable(inputEl, chipContainer, editable, container);
      }
    });

    new ButtonComponent(addRow)
      .setButtonText(t('organize.addBtn'))
      .setClass('organize-tag-add-btn')
      .onClick(() => this.addTagToEditable(inputEl, chipContainer, editable, container));
  }

  private addTagToEditable(input: TextComponent, chipContainer: HTMLElement, editable: EditableItem, card: HTMLElement): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!tag) return;
    if (editable.tags.some(t2 => t2.name === tag)) return;
    editable.tags.push({ name: tag, enabled: true });
    input.setValue('');
    this.renderTagChips(chipContainer, editable);
    const emptyState = card.closest('.organize-batch-card')?.querySelector('.vaultend-empty-state');
    if (emptyState) emptyState.remove();
  }

  private renderTagChips(container: HTMLElement, editable: EditableItem): void {
    container.empty();
    for (const tag of editable.tags) {
      const chip = container.createDiv('organize-chip organize-chip-small');
      if (!tag.enabled) chip.addClass('organize-chip-disabled');

      chip.createSpan({ text: `#${tag.name}`, cls: 'organize-chip-text' });
      const action = chip.createSpan({
        cls: tag.enabled ? 'organize-chip-remove' : 'organize-chip-restore',
        attr: {
          'aria-label': tag.enabled ? t('organize.removeTag') : t('organize.restoreTag'),
          'tabindex': '0',
          'role': 'button',
        },
      });
      action.textContent = tag.enabled ? '×' : '↺';

      action.addEventListener('click', (e) => {
        e.stopPropagation();
        tag.enabled = !tag.enabled;
        this.renderTagChips(container, editable);
      });
      action.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          action.click();
        }
      });
    }
  }

  private renderEditableLinks(container: HTMLElement, editable: EditableItem): void {
    const linksSection = container.createDiv('organize-batch-links');
    linksSection.createSpan({ text: t('organize.linksLabel'), cls: 'organize-batch-label' });

    const chipContainer = linksSection.createDiv('organize-link-chips');
    this.renderLinkChips(chipContainer, editable);

    const addRow = linksSection.createDiv('organize-link-add-row');
    const inputEl = new TextComponent(addRow)
      .setPlaceholder(t('organize.addLinkPlaceholder'));
    inputEl.inputEl.addClass('organize-link-input');

    new ButtonComponent(addRow)
      .setButtonText(t('organize.addLinkBtn'))
      .setClass('organize-link-add-btn')
      .onClick(() => {
        const raw = inputEl.getValue().trim();
        if (!raw) return;
        const cleaned = raw.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
        if (!cleaned) return;
        const linkPath = /\.md$/i.test(cleaned) ? cleaned.replace(/\.md$/i, '.md') : `${cleaned}.md`;
        if (editable.links.some(l => l.path === linkPath)) return;
        editable.links.push({ path: linkPath, enabled: true });
        inputEl.setValue('');
        this.renderLinkChips(chipContainer, editable);
        const emptyState = container.closest('.organize-batch-card')?.querySelector('.vaultend-empty-state');
        if (emptyState) emptyState.remove();
      });
  }

  private renderLinkChips(container: HTMLElement, editable: EditableItem): void {
    container.empty();
    for (const link of editable.links) {
      const chip = container.createDiv('organize-link-chip');
      if (!link.enabled) chip.addClass('organize-chip-disabled');
      const displayName = link.path.replace(/\.md$/i, '').split('/').pop() ?? link.path;
      chip.createSpan({ text: `[[${displayName}]]`, cls: 'organize-link-chip-text' });
      const action = chip.createSpan({
        cls: link.enabled ? 'organize-link-chip-remove' : 'organize-chip-restore',
      });
      action.textContent = link.enabled ? '×' : '↺';
      action.setAttribute('tabindex', '0');
      action.setAttribute('role', 'button');
      action.setAttribute('aria-label', link.enabled ? t('organize.removeLink') : t('organize.restoreLink'));
      action.addEventListener('click', () => {
        link.enabled = !link.enabled;
        this.renderLinkChips(container, editable);
      });
      action.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          action.click();
        }
      });
    }
  }

  private async reorganizeItem(card: HTMLElement, editable: EditableItem): Promise<void> {
    if (!this.onReorganizeNote) return;
    const prevChildren = Array.from(card.childNodes);
    card.empty();
    card.createEl('p', { text: t('organize.reorganizing'), cls: 'organize-reorganizing' });

    this.activeReorgCount++;
    this.applyAllBtn?.setDisabled(true);

    try {
      const newResult = await this.onReorganizeNote(editable.notePath);
      editable.tags = newResult.addedTags.map(name => ({ name, enabled: true }));
      editable.links = this.tagsOnly
        ? []
        : newResult.suggestedLinks.map(path => ({ path, enabled: true }));
      card.empty();
      this.renderItemContent(card, editable);
    } catch (err) {
      card.empty();
      for (const child of prevChildren) card.appendChild(child);
      new Notice(t('notice.organizeFailed', { error: localizeError(err) }));
    } finally {
      this.activeReorgCount--;
      if (this.activeReorgCount === 0) {
        this.applyAllBtn?.setDisabled(false);
      }
    }
  }

  private renderFooter(container: HTMLElement): void {
    const totalTokens = this.items.reduce((sum, i) => sum + i.result.tokenUsage.totalTokens, 0);
    const totalCost = this.items.reduce((sum, i) => sum + i.result.tokenUsage.estimatedCostUsd, 0);
    if (totalTokens > 0) {
      const hasCostData = totalCost >= 0;
      container.createDiv({
        text: hasCostData
          ? t('organizeFolder.tokenTotal', { count: totalTokens.toLocaleString(), cost: totalCost.toFixed(4) })
          : t('organizeFolder.tokenTotalUnavailable', { count: totalTokens.toLocaleString() }),
        cls: 'organize-batch-token-total',
      });
    }

    const footer = container.createDiv('organize-footer');

    this.applyAllBtn = new ButtonComponent(footer)
      .setButtonText(t('organize.applyAll'))
      .setCta()
      .onClick(async () => {
        await this.applyAll();
      });

    new ButtonComponent(footer)
      .setButtonText(t('btn.cancel'))
      .onClick(() => this.close());
  }

  private async applyAll(): Promise<void> {
    let success = 0;
    let failed = 0;
    const appliedEntries: BatchAppliedEntry[] = [];

    for (const editable of this.editableItems) {
      const enabledTags = editable.tags.filter(t => t.enabled).map(t => t.name);
      const enabledLinks = this.tagsOnly ? [] : editable.links.filter(l => l.enabled).map(l => l.path);
      const hasChanges = enabledTags.length > 0 || enabledLinks.length > 0;
      if (!hasChanges) continue;

      let previousContent: string;
      try {
        previousContent = await this.callbacks.readContent(editable.notePath);
      } catch (err) {
        failed++;
        console.error(`Vaultend: batch read failed for ${editable.notePath}`, err);
        continue;
      }

      try {
        const entryId = crypto.randomUUID();

        if (enabledTags.length > 0) {
          await this.callbacks.actions.applyTags(editable.notePath, enabledTags);
        }
        if (enabledLinks.length > 0) {
          await this.callbacks.actions.addLinks(editable.notePath, enabledLinks.map(l => createNotePath(l)));
        }

        const desc = `Organize Selected: tags=${enabledTags.length}, links=${enabledLinks.length}`;
        await this.callbacks.recordHistory(entryId, editable.notePath, previousContent, desc, enabledTags, enabledLinks);

        appliedEntries.push({ notePath: editable.notePath, historyEntryId: entryId });
        success++;
      } catch (err) {
        failed++;
        console.error(`Vaultend: batch apply failed for ${editable.notePath}`, err);
        try {
          await this.callbacks.writeContent(editable.notePath, previousContent);
        } catch (restoreErr) {
          console.error(`Vaultend: failed to restore ${editable.notePath}`, restoreErr);
        }
      }
    }

    if (failed > 0) {
      new Notice(t('notice.organizeSelectedResult', { success, failed }));
    } else {
      new Notice(t('notice.organizeSelectedComplete', { count: success }));
    }

    this.close();
    this.onApplied?.(appliedEntries);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
