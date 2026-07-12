import { App, ButtonComponent, Modal, Notice, TextComponent } from 'obsidian';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { NotePath } from '../domain/values/NotePath';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export interface OrganizeApplyActions {
  applyTags(notePath: NotePath, tags: string[]): Promise<void>;
  addLinks(notePath: NotePath, links: NotePath[]): Promise<void>;
  moveNote(notePath: NotePath, targetFolder: string): Promise<void>;
}

export interface OrganizeModalContext {
  existingFolders: string[];
}

export class OrganizeResultModal extends Modal {
  private selectedTags: string[];
  private selectedLinks: NotePath[];
  private selectedFolder: string | undefined;

  constructor(
    app: App,
    private readonly notePath: NotePath,
    private readonly result: OrganizeResult,
    private readonly actions: OrganizeApplyActions,
    private readonly context: OrganizeModalContext,
  ) {
    super(app);
    this.selectedTags = result.addedTags.map(tag => tag as string);
    this.selectedLinks = [...result.suggestedLinks];
    this.selectedFolder = result.suggestedMoveTarget;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('knowledge-maintenance-organize-result');

    contentEl.createEl('h2', { text: t('organize.title') });

    const noteName = (this.notePath as string).split('/').pop()?.replace('.md', '') ?? '';
    contentEl.createEl('p', {
      text: noteName,
      cls: 'organize-note-name',
    });

    this.renderCategory(contentEl);
    if (this.result.summary) {
      this.renderSummary(contentEl);
    }
    this.renderTags(contentEl);
    this.renderLinks(contentEl);
    this.renderMove(contentEl);
    this.renderFooter(contentEl);
  }

  private renderCategory(container: HTMLElement): void {
    const section = container.createDiv('organize-section');
    section.createEl('h4', { text: t('organize.category') });
    section.createEl('span', {
      text: this.result.classifiedCategory,
      cls: 'organize-category-badge',
    });
  }

  private renderSummary(container: HTMLElement): void {
    const section = container.createDiv('organize-section');
    section.createEl('h4', { text: t('organize.summary') });
    section.createEl('p', {
      text: this.result.summary,
      cls: 'organize-summary-text',
    });
  }

  private renderTags(container: HTMLElement): void {
    const section = container.createDiv('organize-section');
    section.createEl('h4', { text: t('organize.suggestedTags') });

    const tagListEl = section.createDiv('organize-tag-list');
    this.rebuildTagList(tagListEl);

    const addRow = section.createDiv('organize-add-row');
    const input = new TextComponent(addRow);
    input.setPlaceholder(t('organize.addTagPlaceholder'));
    input.inputEl.addClass('organize-add-input');
    input.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addTagFromInput(input, tagListEl);
      }
    });
    new ButtonComponent(addRow)
      .setButtonText(t('organize.addBtn'))
      .onClick(() => this.addTagFromInput(input, tagListEl));
  }

  private rebuildTagList(tagListEl: HTMLElement): void {
    tagListEl.empty();
    if (this.selectedTags.length === 0) {
      tagListEl.createEl('span', { text: t('organize.noTags'), cls: 'organize-empty' });
      return;
    }
    for (const tag of this.selectedTags) {
      const chip = tagListEl.createDiv('organize-chip');
      chip.createEl('span', { text: `#${tag}` });
      const removeBtn = chip.createEl('span', { text: '×', cls: 'organize-chip-remove' });
      removeBtn.addEventListener('click', () => {
        this.selectedTags = this.selectedTags.filter(t2 => t2 !== tag);
        this.rebuildTagList(tagListEl);
      });
    }
  }

  private addTagFromInput(input: TextComponent, tagListEl: HTMLElement): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw.slice(1) : raw;
    if (tag && !this.selectedTags.includes(tag)) {
      this.selectedTags.push(tag);
      this.rebuildTagList(tagListEl);
    }
    input.setValue('');
  }

  private renderLinks(container: HTMLElement): void {
    const section = container.createDiv('organize-section');
    section.createEl('h4', { text: t('organize.suggestedLinks') });

    const linkListEl = section.createDiv('organize-link-list');
    this.rebuildLinkList(linkListEl);

    const addRow = section.createDiv('organize-add-row');
    const input = new TextComponent(addRow);
    input.setPlaceholder(t('organize.addLinkPlaceholder'));
    input.inputEl.addClass('organize-add-input');
    input.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addLinkFromInput(input, linkListEl);
      }
    });
    new ButtonComponent(addRow)
      .setButtonText(t('organize.addBtn'))
      .onClick(() => this.addLinkFromInput(input, linkListEl));
  }

  private rebuildLinkList(linkListEl: HTMLElement): void {
    linkListEl.empty();
    if (this.selectedLinks.length === 0) {
      linkListEl.createEl('span', { text: t('organize.noLinks'), cls: 'organize-empty' });
      return;
    }
    for (const link of this.selectedLinks) {
      const linkPath = (link as string).replace('.md', '');
      const chip = linkListEl.createDiv('organize-chip');
      chip.createEl('span', { text: `[[${linkPath}]]` });
      const removeBtn = chip.createEl('span', { text: '×', cls: 'organize-chip-remove' });
      removeBtn.addEventListener('click', () => {
        this.selectedLinks = this.selectedLinks.filter(l => l !== link);
        this.rebuildLinkList(linkListEl);
      });
    }
  }

  private addLinkFromInput(input: TextComponent, linkListEl: HTMLElement): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const cleaned = raw.replace(/^\[\[/, '').replace(/\]\]$/, '');
    const path = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
    const asNotePath = path as unknown as NotePath;
    if (!this.selectedLinks.some(l => (l as string) === path)) {
      this.selectedLinks.push(asNotePath);
      this.rebuildLinkList(linkListEl);
    }
    input.setValue('');
  }

  private renderMove(container: HTMLElement): void {
    const section = container.createDiv('organize-section');
    section.createEl('h4', { text: t('organize.suggestedMove') });

    const folders = this.context.existingFolders;

    if (folders.length === 0) {
      section.createEl('p', { text: t('organize.noMove'), cls: 'organize-empty' });
      return;
    }

    const selectEl = section.createEl('select', { cls: 'organize-folder-select' });

    const noneOption = selectEl.createEl('option', { text: t('organize.keepCurrent'), value: '' });
    if (!this.selectedFolder) noneOption.selected = true;

    for (const folder of folders) {
      const opt = selectEl.createEl('option', { text: folder, value: folder });
      if (folder === this.selectedFolder) opt.selected = true;
    }

    selectEl.addEventListener('change', () => {
      this.selectedFolder = selectEl.value || undefined;
    });
  }

  private renderTokenUsage(container: HTMLElement): void {
    const usage = this.result.tokenUsage;
    const parts = [
      t('organize.tokens', { count: usage.totalTokens.toLocaleString() }),
      t('organize.cost', { amount: usage.estimatedCostUsd.toFixed(4) }),
    ];
    container.createEl('p', { text: parts.join(' · '), cls: 'organize-token-info' });
  }

  private renderFooter(container: HTMLElement): void {
    this.renderTokenUsage(container);
    const footer = container.createDiv('organize-footer');

    new ButtonComponent(footer)
      .setButtonText(t('organize.applyAll'))
      .setCta()
      .onClick(async () => {
        await this.applyAll();
      });

    new ButtonComponent(footer)
      .setButtonText(t('btn.close'))
      .onClick(() => this.close());
  }

  private async applyAll(): Promise<void> {
    const applied: string[] = [];

    try {
      if (this.selectedTags.length > 0) {
        await this.actions.applyTags(this.notePath, this.selectedTags);
        applied.push(t('organize.tagsApplied', { count: String(this.selectedTags.length) }));
        this.selectedTags = [];
      }

      if (this.selectedLinks.length > 0) {
        await this.actions.addLinks(this.notePath, this.selectedLinks);
        applied.push(t('organize.linksAdded', { count: String(this.selectedLinks.length) }));
        this.selectedLinks = [];
      }

      if (this.selectedFolder) {
        await this.actions.moveNote(this.notePath, this.selectedFolder);
        applied.push(t('organize.noteMoved', { folder: this.selectedFolder }));
        this.selectedFolder = undefined;
      }

      if (applied.length > 0) {
        new Notice(applied.join('\n'));
      } else {
        new Notice(t('organize.nothingToApply'));
      }

      this.close();
    } catch (err) {
      new Notice(t('notice.actionFailed', { error: localizeError(err) }));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
