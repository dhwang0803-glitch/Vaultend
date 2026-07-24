import { App, ButtonComponent, Modal, Notice, TextComponent } from 'obsidian';
import { HistoryPort } from '../application/ports/HistoryPort';
import { VaultAccessPort } from '../application/ports/VaultAccessPort';
import { HISTORY_CHANGED_EVENT } from '../constants';
import { OrganizeResult } from '../domain/models/OrganizeModels';
import { NotePath } from '../domain/values/NotePath';
import { createTimestamp } from '../domain/values/Timestamp';
import { t } from '../i18n';
import { localizeError } from './localizeError';

export interface OrganizeApplyActions {
  applyTags(notePath: NotePath, tags: string[]): Promise<void>;
  addLinks(notePath: NotePath, links: NotePath[]): Promise<void>;
}

interface TagItem { name: string; enabled: boolean }
interface LinkItem { path: NotePath; enabled: boolean }

export class OrganizeResultModal extends Modal {
  private tagItems: TagItem[];
  private linkItems: LinkItem[];

  constructor(
    app: App,
    private readonly notePath: NotePath,
    private readonly result: OrganizeResult,
    private readonly actions: OrganizeApplyActions,
    private readonly historyPort: HistoryPort,
    private readonly vault: VaultAccessPort,
  ) {
    super(app);
    this.tagItems = result.addedTags.map(name => ({ name, enabled: true }));
    this.linkItems = result.suggestedLinks.map(path => ({ path, enabled: true }));
  }

  onOpen(): void {
    this.modalEl.addClass('vaultend-organize-modal');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vaultend-organize-result');

    contentEl.createEl('h2', { text: t('organize.title') });

    const noteName = this.notePath.split('/').pop()?.replace('.md', '') ?? '';
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
    if (this.tagItems.length === 0) {
      tagListEl.createSpan({ text: t('organize.noTags'), cls: 'organize-empty' });
      return;
    }
    for (const item of this.tagItems) {
      const reason = this.result.tagReasons?.get(item.name) ?? this.result.tagReasons?.get(`#${item.name}`);
      const chipClasses = ['organize-chip'];
      if (reason?.isNew) chipClasses.push('organize-chip-new');
      if (!item.enabled) chipClasses.push('organize-chip-disabled');

      const chip = tagListEl.createDiv(chipClasses.join(' '));
      if (reason?.reason) {
        chip.setAttribute('title', reason.reason);
      }
      chip.createSpan({ text: `#${item.name}` });
      if (reason) {
        chip.createSpan({
          text: String(reason.score),
          cls: 'organize-chip-score',
        });
      }
      const action = chip.createSpan({
        text: item.enabled ? '×' : '↺',
        cls: item.enabled ? 'organize-chip-remove' : 'organize-chip-restore',
      });
      action.addEventListener('click', () => {
        item.enabled = !item.enabled;
        this.rebuildTagList(tagListEl);
      });
    }
  }

  private addTagFromInput(input: TextComponent, tagListEl: HTMLElement): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const tag = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!tag) return;
    if (!this.tagItems.some(item => item.name === tag)) {
      this.tagItems.push({ name: tag, enabled: true });
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
    if (this.linkItems.length === 0) {
      linkListEl.createSpan({ text: t('organize.noLinks'), cls: 'organize-empty' });
      return;
    }
    for (const item of this.linkItems) {
      const linkPath = item.path.replace('.md', '');
      const chipClasses = ['organize-chip'];
      if (!item.enabled) chipClasses.push('organize-chip-disabled');

      const chip = linkListEl.createDiv(chipClasses.join(' '));
      chip.createSpan({ text: `[[${linkPath}]]` });
      const action = chip.createSpan({
        text: item.enabled ? '×' : '↺',
        cls: item.enabled ? 'organize-chip-remove' : 'organize-chip-restore',
      });
      action.addEventListener('click', () => {
        item.enabled = !item.enabled;
        this.rebuildLinkList(linkListEl);
      });
    }
  }

  private addLinkFromInput(input: TextComponent, linkListEl: HTMLElement): void {
    const raw = input.getValue().trim();
    if (!raw) return;
    const cleaned = raw.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
    if (!cleaned) return;
    const path = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
    const asNotePath = path as unknown as NotePath;
    if (!this.linkItems.some(item => item.path === path)) {
      this.linkItems.push({ path: asNotePath, enabled: true });
      this.rebuildLinkList(linkListEl);
    }
    input.setValue('');
  }

  private renderTokenUsage(container: HTMLElement): void {
    const usage = this.result.tokenUsage;
    const costText = usage.estimatedCostUsd < 0
      ? t('organize.costUnavailable')
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
    const tagsToApply = this.tagItems.filter(i => i.enabled).map(i => i.name);
    const linksToApply = this.linkItems.filter(i => i.enabled).map(i => i.path);

    if (tagsToApply.length === 0 && linksToApply.length === 0) {
      new Notice(t('organize.nothingToApply'));
      return;
    }

    let previousContent = '';
    try {
      const note = await this.vault.readNote(this.notePath);
      previousContent = note?.content ?? '';

      if (tagsToApply.length > 0) {
        await this.actions.applyTags(this.notePath, tagsToApply);
      }
      if (linksToApply.length > 0) {
        await this.actions.addLinks(this.notePath, linksToApply);
      }

      const entryId = crypto.randomUUID();
      try {
        await this.historyPort.record({
          id: entryId,
          action: 'classify',
          notePath: this.notePath,
          timestamp: createTimestamp(Date.now()),
          description: `Organized: tags=${tagsToApply.length}, links=${linksToApply.length}`,
          previousContent,
          metadata: { tags: tagsToApply, links: [...linksToApply] },
        });
      } catch {
        await this.vault.writeNote(this.notePath, previousContent);
        throw new Error('history-record-failed');
      }

      this.app.workspace.trigger(HISTORY_CHANGED_EVENT);
      this.tagItems = [];
      this.linkItems = [];
      this.close();

      this.showUndoNotice(tagsToApply, linksToApply, entryId);
    } catch (err) {
      new Notice(t('notice.actionFailed', { error: localizeError(err) }));
    }
  }

  private showUndoNotice(tags: string[], links: NotePath[], entryId: string): void {
    const applied: string[] = [];
    if (tags.length > 0) {
      applied.push(t('organize.tagsApplied', { count: String(tags.length) }));
    }
    if (links.length > 0) {
      applied.push(t('organize.linksAdded', { count: String(links.length) }));
    }

    const fragment = createFragment();
    fragment.appendText(applied.join('\n'));

    const undoBtn = fragment.createEl('button', {
      text: t('log.undo'),
      cls: 'mod-warning vaultend-notice-undo',
    });

    const notice = new Notice(fragment, 10_000);

    undoBtn.addEventListener('click', () => {
      void (async () => {
        try {
          await this.historyPort.undo(entryId);
          notice.hide();
          new Notice(t('undo.success'));
          this.app.workspace.trigger(HISTORY_CHANGED_EVENT, entryId);
        } catch (err) {
          new Notice(t('undo.failed', { error: localizeError(err) }));
        }
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
