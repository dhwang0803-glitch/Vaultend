import { Modal, App, setIcon } from 'obsidian';
import { t } from '../i18n';

interface ChangeItem {
  readonly icon: string;
  readonly title: string;
  readonly desc: string;
}

interface ChangelogSection {
  readonly label: string;
  readonly items: readonly ChangeItem[];
}

export interface ChangelogEntry {
  readonly version: string;
  readonly sections: readonly ChangelogSection[];
}

const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '1.0.20',
    sections: [
      {
        label: 'Bug Fixes',
        items: [
          {
            icon: 'shield-check',
            title: 'Maintenance: cross-category sync',
            desc: 'Deleting or archiving a note now disables it across all maintenance categories. Undo restores it everywhere.',
          },
          {
            icon: 'refresh-cw',
            title: 'Organize Folder: content-aware re-processing',
            desc: 'Edited notes are now re-processed on the next Organize Folder run. Previously they were permanently skipped.',
          },
        ],
      },
      {
        label: 'Internal',
        items: [
          {
            icon: 'trash-2',
            title: 'Removed "processed" frontmatter',
            desc: 'No longer written or checked. Existing values in your notes are harmless — remove at your convenience.',
          },
        ],
      },
    ],
  },
];

export class WhatsNewModal extends Modal {
  constructor(app: App, private readonly fromVersion: string | null) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('vaultend-whats-new');

    const header = contentEl.createDiv({ cls: 'vaultend-wn-header' });
    const iconEl = header.createSpan({ cls: 'vaultend-wn-header-icon' });
    setIcon(iconEl, 'sparkles');
    header.createEl('h2', { text: t('whatsNew.title') });

    const entries = this.fromVersion
      ? CHANGELOG.filter(e => this.isNewer(e.version, this.fromVersion!))
      : [CHANGELOG[0]];

    if (entries.length === 0 && CHANGELOG.length > 0) {
      entries.push(CHANGELOG[0]);
    }

    for (const entry of entries) {
      const versionBadge = contentEl.createDiv({ cls: 'vaultend-wn-version' });
      versionBadge.createSpan({ text: `v${entry.version}` });

      for (const section of entry.sections) {
        const sectionEl = contentEl.createDiv({ cls: 'vaultend-wn-section' });
        sectionEl.createEl('h4', { text: section.label, cls: 'vaultend-wn-section-label' });

        for (const item of section.items) {
          const card = sectionEl.createDiv({ cls: 'vaultend-wn-card' });
          const cardIcon = card.createSpan({ cls: 'vaultend-wn-card-icon' });
          setIcon(cardIcon, item.icon);
          const cardBody = card.createDiv({ cls: 'vaultend-wn-card-body' });
          cardBody.createEl('strong', { text: item.title });
          cardBody.createEl('p', { text: item.desc });
        }
      }
    }

    const footer = contentEl.createDiv({ cls: 'vaultend-wn-footer' });
    footer.createEl('button', { text: t('whatsNew.dismiss') }, btn => {
      btn.addClass('mod-cta');
      btn.addEventListener('click', () => this.close());
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private isNewer(version: string, baseline: string): boolean {
    const parse = (v: string) => v.split('.').map(Number);
    const [aMaj, aMin, aPat] = parse(version);
    const [bMaj, bMin, bPat] = parse(baseline);
    if (aMaj !== bMaj) return aMaj > bMaj;
    if (aMin !== bMin) return aMin > bMin;
    return aPat > bPat;
  }
}
