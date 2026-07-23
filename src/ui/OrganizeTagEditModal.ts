import { Modal, Setting, App } from 'obsidian';
import { TagName } from '../domain/values/TagName';
import { t } from '../i18n';

export interface TagGroupEditResult {
  readonly canonical: string;
  readonly variants: ReadonlyArray<string>;
}

export class OrganizeTagEditModal extends Modal {
  private selectedCanonical: string;
  private includedVariants: Set<string>;
  private customCanonical = '';
  private checkboxes: Array<{ tag: string; cb: HTMLInputElement }> = [];
  private resolve: ((result: TagGroupEditResult | null) => void) | null = null;

  constructor(
    app: App,
    private readonly canonicalTag: TagName,
    private readonly variants: ReadonlyArray<{ tag: TagName; count: number }>,
  ) {
    super(app);
    this.selectedCanonical = canonicalTag;
    this.includedVariants = new Set(variants.map(v => v.tag));
  }

  prompt(): Promise<TagGroupEditResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: t('organizeTags.editTitle') });

    new Setting(contentEl)
      .setName(t('organizeTags.editCanonical'))
      .addDropdown(dd => {
        for (const v of this.variants) {
          dd.addOption(v.tag, `${v.tag} (${v.count})`);
        }
        dd.setValue(this.selectedCanonical);
        dd.onChange(val => {
          this.selectedCanonical = val;
          this.customCanonical = '';
          this.includedVariants.add(val);
          this.syncCheckboxes();
        });
      });

    new Setting(contentEl)
      .setName(t('organizeTags.editCustom'))
      .addText(text => {
        text.setPlaceholder('#custom-tag');
        text.onChange(val => {
          this.customCanonical = val.trim();
          this.syncCheckboxes();
        });
      });

    contentEl.createEl('h4', { text: t('organizeTags.editVariants') });
    const variantContainer = contentEl.createDiv({ cls: 'organize-tags-edit-variants' });
    this.checkboxes = [];

    for (const v of this.variants) {
      const tagStr = v.tag;
      const row = variantContainer.createDiv({ cls: 'organize-tags-edit-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = true;
      row.createSpan({ text: `${tagStr} (${v.count})` });

      this.checkboxes.push({ tag: tagStr, cb });

      cb.addEventListener('change', () => {
        if (cb.checked) {
          this.includedVariants.add(tagStr);
        } else {
          this.includedVariants.delete(tagStr);
        }
      });
    }

    this.syncCheckboxes();

    new Setting(contentEl)
      .addButton(btn =>
        btn.setButtonText(t('organizeTags.editSave'))
          .setCta()
          .onClick(() => {
            let canonical = this.customCanonical || this.selectedCanonical;
            if (!canonical.startsWith('#')) canonical = `#${canonical}`;
            const variants = [...this.includedVariants].filter(v => v !== canonical);
            this.resolve?.({ canonical, variants });
            this.resolve = null;
            this.close();
          }),
      )
      .addButton(btn =>
        btn.setButtonText(t('btn.cancel'))
          .onClick(() => {
            this.resolve?.(null);
            this.resolve = null;
            this.close();
          }),
      );
  }

  private syncCheckboxes(): void {
    const effectiveCanonical = this.customCanonical || this.selectedCanonical;
    for (const { tag, cb } of this.checkboxes) {
      const isCanonical = tag === effectiveCanonical;
      cb.disabled = isCanonical;
      if (isCanonical) {
        cb.checked = true;
        this.includedVariants.add(tag);
      }
    }
  }

  onClose(): void {
    this.resolve?.(null);
    this.resolve = null;
    this.contentEl.empty();
  }
}
