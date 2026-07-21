import { App, ButtonComponent, Modal, Notice } from 'obsidian';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { NotePath } from '../domain/values/NotePath';
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

export class OrganizeBatchPreviewModal extends Modal {
  private onApplied?: (entries: ReadonlyArray<BatchAppliedEntry>) => void;

  constructor(
    app: App,
    private readonly items: ReadonlyArray<BatchPreviewItem>,
    private readonly callbacks: BatchOrganizeCallbacks,
  ) {
    super(app);
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
    for (const item of this.items) {
      this.renderItem(list, item);
    }

    this.renderFooter(contentEl);
  }

  private renderItem(container: HTMLElement, item: BatchPreviewItem): void {
    const card = container.createDiv('organize-batch-card');
    const noteName = (item.notePath as string).split('/').pop()?.replace('.md', '') ?? '';
    card.createEl('div', { text: noteName, cls: 'organize-batch-card-name' });

    const details = card.createDiv('organize-batch-card-details');

    if (item.result.addedTags.length > 0) {
      const tagLine = details.createDiv('organize-batch-tags');
      tagLine.createEl('span', { text: t('organize.tagsLabel'), cls: 'organize-batch-label' });
      for (const tag of item.result.addedTags) {
        tagLine.createEl('span', { text: `#${tag as string}`, cls: 'organize-chip organize-chip-small' });
      }
    }

    if (item.result.suggestedLinks.length > 0) {
      const linkLine = details.createDiv('organize-batch-links');
      linkLine.createEl('span', { text: t('organize.linksLabel'), cls: 'organize-batch-label' });
      const linkText = item.result.suggestedLinks
        .map(l => `[[${(l as string).replace('.md', '')}]]`)
        .join(', ');
      linkLine.createEl('span', { text: linkText, cls: 'organize-batch-link-text' });
    }

    if (item.result.addedTags.length === 0 && item.result.suggestedLinks.length === 0) {
      details.createEl('span', { text: t('organize.noChanges'), cls: 'organize-empty' });
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

    for (const item of this.items) {
      const hasChanges = item.result.addedTags.length > 0 || item.result.suggestedLinks.length > 0;
      if (!hasChanges) continue;

      let previousContent: string;
      try {
        previousContent = await this.callbacks.readContent(item.notePath);
      } catch (err) {
        failed++;
        console.error(`Vaultend: batch read failed for ${item.notePath as string}`, err);
        continue;
      }

      try {
        const entryId = crypto.randomUUID();

        if (item.result.addedTags.length > 0) {
          const tags = item.result.addedTags.map(tag => tag as string);
          await this.callbacks.actions.applyTags(item.notePath, tags);
        }
        if (item.result.suggestedLinks.length > 0) {
          await this.callbacks.actions.addLinks(item.notePath, [...item.result.suggestedLinks]);
        }

        const tags = item.result.addedTags.map(tg => tg as string);
        const links = item.result.suggestedLinks.map(l => l as string);
        const desc = `Organize Selected: tags=${tags.length}, links=${links.length}`;
        await this.callbacks.recordHistory(entryId, item.notePath, previousContent, desc, tags, links);

        appliedEntries.push({ notePath: item.notePath, historyEntryId: entryId });
        success++;
      } catch (err) {
        failed++;
        console.error(`Vaultend: batch apply failed for ${item.notePath as string}`, err);
        try {
          await this.callbacks.writeContent(item.notePath, previousContent);
        } catch (restoreErr) {
          console.error(`Vaultend: failed to restore ${item.notePath as string}`, restoreErr);
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
