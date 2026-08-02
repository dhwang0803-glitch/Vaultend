import { Modal, App, setIcon } from 'obsidian';
import { t, type LocaleKey } from '../i18n';

interface ChangeItem {
  readonly icon: string;
  readonly titleKey: LocaleKey;
  readonly descKey: LocaleKey;
}

interface ChangelogSection {
  readonly labelKey: LocaleKey;
  readonly items: readonly ChangeItem[];
}

export interface ChangelogEntry {
  readonly version: string;
  readonly sections: readonly ChangelogSection[];
}

const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '1.0.22',
    sections: [
      {
        labelKey: 'whatsNew.section.bugFixes',
        items: [
          {
            icon: 'zap',
            titleKey: 'whatsNew.v1022.perfLag.title',
            descKey: 'whatsNew.v1022.perfLag.desc',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.21',
    sections: [
      {
        labelKey: 'whatsNew.section.added',
        items: [
          {
            icon: 'languages',
            titleKey: 'whatsNew.v1021.tagLang.title',
            descKey: 'whatsNew.v1021.tagLang.desc',
          },
          {
            icon: 'globe',
            titleKey: 'whatsNew.v1021.whatsNewI18n.title',
            descKey: 'whatsNew.v1021.whatsNewI18n.desc',
          },
          {
            icon: 'message-circle',
            titleKey: 'whatsNew.v1021.organizeMsg.title',
            descKey: 'whatsNew.v1021.organizeMsg.desc',
          },
        ],
      },
      {
        labelKey: 'whatsNew.section.bugFixes',
        items: [
          {
            icon: 'cpu',
            titleKey: 'whatsNew.v1021.gpt5.title',
            descKey: 'whatsNew.v1021.gpt5.desc',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.20',
    sections: [
      {
        labelKey: 'whatsNew.section.bugFixes',
        items: [
          {
            icon: 'shield-check',
            titleKey: 'whatsNew.v1020.crossSync.title',
            descKey: 'whatsNew.v1020.crossSync.desc',
          },
          {
            icon: 'refresh-cw',
            titleKey: 'whatsNew.v1020.reprocess.title',
            descKey: 'whatsNew.v1020.reprocess.desc',
          },
        ],
      },
      {
        labelKey: 'whatsNew.section.internal',
        items: [
          {
            icon: 'trash-2',
            titleKey: 'whatsNew.v1020.processed.title',
            descKey: 'whatsNew.v1020.processed.desc',
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
        sectionEl.createEl('h4', { text: t(section.labelKey), cls: 'vaultend-wn-section-label' });

        for (const item of section.items) {
          const card = sectionEl.createDiv({ cls: 'vaultend-wn-card' });
          const cardIcon = card.createSpan({ cls: 'vaultend-wn-card-icon' });
          setIcon(cardIcon, item.icon);
          const cardBody = card.createDiv({ cls: 'vaultend-wn-card-body' });
          cardBody.createEl('strong', { text: t(item.titleKey) });
          cardBody.createEl('p', { text: t(item.descKey) });
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
