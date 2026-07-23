import { App, ButtonComponent, Modal, Notice, TextComponent } from 'obsidian';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { NotePath, createNotePath } from '../domain/values/NotePath';
import type { OrganizeApplyActions } from './OrganizeResultModal';
import { t } from '../i18n';

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

  constructor(
    app: App,
    private readonly items: ReadonlyArray<BatchPreviewItem>,
    private readonly callbacks: BatchOrganizeCallbacks,
    private readonly tagsOnly: boolean = false,
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
    const noteName = editable.notePath.split('/').pop()?.replace('.md', '') ?? '';
    card.createDiv({ text: noteName, cls: 'organize-batch-card-name' });

    const details = card.createDiv('organize-batch-card-details');

    if (editable.tags.length > 0) {
      const tagLine = details.createDiv('organize-batch-tags');
      tagLine.createSpan({ text: t('organize.tagsLabel'), cls: 'organize-batch-label' });
      const chipContainer = tagLine.createDiv('organize-batch-tag-chips');
      this.renderTagChips(chipContainer, editable);
    }

    if (!this.tagsOnly) {
      this.renderEditableLinks(details, editable);
    }

    if (editable.tags.length === 0 && (this.tagsOnly || editable.links.length === 0)) {
      details.createSpan({ text: t('organize.noChanges'), cls: 'organize-empty organize-empty-state' });
    }
  }

  private renderTagChips(container: HTMLElement, editable: EditableItem): void {
    container.empty();
    for (const tag of editable.tags) {
      const chip = container.createDiv('organize-chip organize-chip-small');
      if (!tag.enabled) chip.addClass('organize-chip-disabled');

      chip.createSpan({ text: `#${tag.name}`, cls: 'organize-chip-text' });
      const action = chip.createSpan({
        cls: tag.enabled ? 'organize-chip-remove' : 'organize-chip-restore',
        attr: { 'aria-label': tag.enabled ? 'Remove' : 'Restore' },
      });
      action.textContent = tag.enabled ? '×' : '↺';

      action.addEventListener('click', (e) => {
        e.stopPropagation();
        tag.enabled = !tag.enabled;
        this.renderTagChips(container, editable);
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
        const emptyState = container.closest('.organize-batch-card')?.querySelector('.organize-empty-state');
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
      action.addEventListener('click', () => {
        link.enabled = !link.enabled;
        this.renderLinkChips(container, editable);
      });
    }
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv('organize-footer');

    new ButtonComponent(footer)
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
      const enabledLinks = editable.links.filter(l => l.enabled).map(l => l.path);
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
