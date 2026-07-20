import { App, ButtonComponent, Modal, Notice, TextComponent } from 'obsidian';
import { OrganizeResult, TagReason } from '../domain/models/OrganizeModels';
import { NotePath } from '../domain/values/NotePath';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export interface OrganizeApplyActions {
  applyTags(notePath: NotePath, tags: string[]): Promise<void>;
  addLinks(notePath: NotePath, links: NotePath[]): Promise<void>;
}

export class OrganizeResultModal extends Modal {
  private selectedTags: string[];
  private selectedLinks: NotePath[];

  constructor(
    app: App,
    private readonly notePath: NotePath,
    private readonly result: OrganizeResult,
    private readonly actions: OrganizeApplyActions,
  ) {
    super(app);
    this.selectedTags = result.addedTags.map(tag => tag as string);
    this.selectedLinks = [...result.suggestedLinks];
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-organize-result');

    contentEl.createEl('h2', { text: t('organize.title') });

    const noteName = (this.notePath as string).split('/').pop()?.replace('.md', '') ?? '';
    contentEl.createEl('p', {
      text: noteName,
      cls: 'organize-note-name',
    });

    if (this.result.summary) {
      this.renderSummary(contentEl);
    }
    this.renderTags(contentEl);
    this.renderLinks(contentEl);
    this.renderFooter(contentEl);
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
      const reason = this.result.tagReasons?.get(tag) ?? this.result.tagReasons?.get(`#${tag}`);
      const chipClasses = ['organize-chip'];
      if (reason?.isNew) chipClasses.push('organize-chip-new');

      const chip = tagListEl.createDiv(chipClasses.join(' '));
      if (reason?.reason) {
        chip.setAttribute('title', reason.reason);
      }
      chip.createEl('span', { text: `#${tag}` });
      if (reason) {
        chip.createEl('span', {
          text: String(reason.score),
          cls: 'organize-chip-score',
        });
      }
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

  private renderTokenUsage(container: HTMLElement): void {
    const usage = this.result.tokenUsage;
    const costText = usage.estimatedCostUsd < 0
      ? t('organize.costUnavailable' as any)
      : t('organize.cost', { amount: usage.estimatedCostUsd.toFixed(4) });
    const parts = [
      t('organize.tokens', { count: usage.totalTokens.toLocaleString() }),
      costText,
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
