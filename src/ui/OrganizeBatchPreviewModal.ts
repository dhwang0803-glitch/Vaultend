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

interface EditableItem {
  readonly notePath: NotePath;
  readonly tags: ReadonlyArray<string>;
  links: string[];
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
      tags: item.result.addedTags.map(tag => tag as string),
      links: item.result.suggestedLinks.map(link => link as string),
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
    const noteName = (editable.notePath as string).split('/').pop()?.replace('.md', '') ?? '';
    card.createEl('div', { text: noteName, cls: 'organize-batch-card-name' });

    const details = card.createDiv('organize-batch-card-details');

    if (editable.tags.length > 0) {
      const tagLine = details.createDiv('organize-batch-tags');
      tagLine.createEl('span', { text: t('organize.tagsLabel'), cls: 'organize-batch-label' });
      for (const tag of editable.tags) {
        tagLine.createEl('span', { text: `#${tag}`, cls: 'organize-chip organize-chip-small' });
      }
    }

    if (!this.tagsOnly) {
      this.renderEditableLinks(details, editable);
    }

    if (editable.tags.length === 0 && (this.tagsOnly || editable.links.length === 0)) {
      details.createEl('span', { text: t('organize.noChanges'), cls: 'organize-empty organize-empty-state' });
    }
  }

  private renderEditableLinks(container: HTMLElement, editable: EditableItem): void {
    const linksSection = container.createDiv('organize-batch-links');
    linksSection.createEl('span', { text: t('organize.linksLabel'), cls: 'organize-batch-label' });

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
        if (editable.links.includes(linkPath)) return;
        editable.links.push(linkPath);
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
      const displayName = link.replace(/\.md$/i, '').split('/').pop() ?? link;
      chip.createEl('span', { text: `[[${displayName}]]`, cls: 'organize-link-chip-text' });
      chip.createEl('span', {
        text: '×',
        cls: 'organize-link-chip-remove',
      }).addEventListener('click', () => {
        editable.links = editable.links.filter(l => l !== link);
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
      const hasChanges = editable.tags.length > 0 || editable.links.length > 0;
      if (!hasChanges) continue;

      let previousContent: string;
      try {
        previousContent = await this.callbacks.readContent(editable.notePath);
      } catch (err) {
        failed++;
        console.error(`Vaultend: batch read failed for ${editable.notePath as string}`, err);
        continue;
      }

      try {
        const entryId = crypto.randomUUID();

        if (editable.tags.length > 0) {
          await this.callbacks.actions.applyTags(editable.notePath, [...editable.tags]);
        }
        if (editable.links.length > 0) {
          await this.callbacks.actions.addLinks(editable.notePath, editable.links.map(l => createNotePath(l)));
        }

        const desc = `Organize Selected: tags=${editable.tags.length}, links=${editable.links.length}`;
        await this.callbacks.recordHistory(entryId, editable.notePath, previousContent, desc, [...editable.tags], [...editable.links]);

        appliedEntries.push({ notePath: editable.notePath, historyEntryId: entryId });
        success++;
      } catch (err) {
        failed++;
        console.error(`Vaultend: batch apply failed for ${editable.notePath as string}`, err);
        try {
          await this.callbacks.writeContent(editable.notePath, previousContent);
        } catch (restoreErr) {
          console.error(`Vaultend: failed to restore ${editable.notePath as string}`, restoreErr);
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
