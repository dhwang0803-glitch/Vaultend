import { App, Plugin, PluginSettingTab as ObsidianSettingTab, Setting } from 'obsidian';
import { ConfigPort, PluginSettings } from '../application/ports/ConfigPort';
import { PrivacyRule, PrivacyRuleType } from '../domain/models/PrivacyRule';
import { t, setLocale, detectObsidianLocale, type SupportedLocale } from '../i18n';
import { MAINTENANCE_RESULT_VIEW_TYPE, MAINTENANCE_LOG_VIEW_TYPE, INBOX_STATUS_VIEW_TYPE } from '../constants';

export class PluginSettingTab extends ObsidianSettingTab {
  private settings: PluginSettings | null = null;

  constructor(
    app: App,
    private readonly plugin: Plugin,
    private readonly config: ConfigPort,
  ) {
    super(app, plugin);
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    this.settings = await this.config.getSettings();

    containerEl.createEl('h2', { text: t('settings.title') });

    // --- Language ---
    containerEl.createEl('h3', { text: t('settings.language') });

    new Setting(containerEl)
      .setName(t('settings.locale'))
      .setDesc(t('settings.localeDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('auto', t('settings.localeAuto'))
          .addOption('en', 'English')
          .addOption('ko', '한국어')
          .setValue(this.settings!.locale)
          .onChange(async (value) => {
            await this.config.updateSettings({ locale: value as 'auto' | 'en' | 'ko' });
            const resolved = value === 'auto' ? detectObsidianLocale() : value as SupportedLocale;
            setLocale(resolved);
            this.refreshOpenViews();
            this.display();
          });
      });

    // --- AI Provider ---
    containerEl.createEl('h3', { text: t('settings.aiProvider') });

    new Setting(containerEl)
      .setName(t('settings.aiProviderName'))
      .setDesc(t('settings.aiProviderDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('gemini', 'Google Gemini')
          .setValue(this.settings!.aiProvider)
          .onChange(async (value) => {
            await this.config.updateSettings({
              aiProvider: value as 'openai' | 'gemini',
            });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.apiKey'))
      .setDesc(t('settings.apiKeyDesc'))
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.settings!.aiApiKey)
          .onChange(async (value) => {
            await this.config.updateSettings({ aiApiKey: value });
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName(t('settings.model'))
      .setDesc(t('settings.modelDesc'))
      .addText(text => {
        text
          .setPlaceholder('gpt-4o')
          .setValue(this.settings!.aiModel)
          .onChange(async (value) => {
            await this.config.updateSettings({ aiModel: value });
          });
      });

    // --- Inbox ---
    containerEl.createEl('h3', { text: t('settings.inbox') });

    new Setting(containerEl)
      .setName(t('settings.inboxFolder'))
      .setDesc(t('settings.inboxFolderDesc'))
      .addText(text => {
        text
          .setPlaceholder('Inbox')
          .setValue(this.settings!.inboxFolder)
          .onChange(async (value) => {
            await this.config.updateSettings({ inboxFolder: value });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.autoApply'))
      .setDesc(t('settings.autoApplyDesc'))
      .addToggle(toggle => {
        toggle
          .setValue(this.settings!.autoApplyInbox)
          .onChange(async (value) => {
            await this.config.updateSettings({ autoApplyInbox: value });
          });
      });

    // --- Quick Ask ---
    containerEl.createEl('h3', { text: t('settings.quickAsk') });

    new Setting(containerEl)
      .setName(t('settings.saveMode'))
      .setDesc(t('settings.saveModeDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('timestamp', t('settings.saveModeTimestamp'))
          .addOption('daily-note', t('settings.saveModeDailyNote'))
          .setValue(this.settings!.quickAskSaveMode)
          .onChange(async (value) => {
            await this.config.updateSettings({
              quickAskSaveMode: value as 'timestamp' | 'daily-note',
            });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.maxTokens'))
      .setDesc(t('settings.maxTokensDesc'))
      .addSlider(slider => {
        slider
          .setLimits(1024, 16384, 1024)
          .setValue(this.settings!.aiMaxTokens)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.config.updateSettings({ aiMaxTokens: value });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.dailyNoteLimit'))
      .setDesc(t('settings.dailyNoteLimitDesc'))
      .addText(text => {
        text
          .setPlaceholder('200')
          .setValue(String(this.settings!.dailyNoteSizeLimitKB))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              await this.config.updateSettings({ dailyNoteSizeLimitKB: parsed });
            }
          });
      });

    // --- Maintenance ---
    containerEl.createEl('h3', { text: t('settings.maintenance') });

    new Setting(containerEl)
      .setName(t('settings.autoMaintenance'))
      .setDesc(t('settings.autoMaintenanceDesc'))
      .addToggle(toggle => {
        toggle
          .setValue(this.settings!.maintenanceEnabled)
          .onChange(async (value) => {
            await this.config.updateSettings({ maintenanceEnabled: value });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.maintenanceInterval'))
      .setDesc(t('settings.maintenanceIntervalDesc'))
      .addText(text => {
        text
          .setPlaceholder('60')
          .setValue(String(this.settings!.maintenanceIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              await this.config.updateSettings({ maintenanceIntervalMinutes: parsed });
            }
          });
      });

    new Setting(containerEl)
      .setName(t('settings.excludeFolders'))
      .setDesc(t('settings.excludeFoldersDesc'))
      .addText(text => {
        const folders = this.settings!.maintenanceExcludeFolders ?? [];
        text
          .setPlaceholder('QuickAsk, Templates')
          .setValue(folders.join(', '))
          .onChange(async (value) => {
            const parsed = value.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(s => s.length > 0);
            await this.config.updateSettings({ maintenanceExcludeFolders: parsed });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.excludeFiles'))
      .setDesc(t('settings.excludeFilesDesc'))
      .addText(text => {
        const patterns = this.settings!.maintenanceExcludeFiles ?? [];
        text
          .setPlaceholder('*.excalidraw.md, README.md')
          .setValue(patterns.join(', '))
          .onChange(async (value) => {
            const parsed = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
            await this.config.updateSettings({ maintenanceExcludeFiles: parsed });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.excludeTags'))
      .setDesc(t('settings.excludeTagsDesc'))
      .addText(text => {
        const tags = this.settings!.maintenanceExcludeTags ?? [];
        text
          .setPlaceholder('#template, #archive')
          .setValue(tags.join(', '))
          .onChange(async (value) => {
            const parsed = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
            await this.config.updateSettings({ maintenanceExcludeTags: parsed });
          });
      });

    new Setting(containerEl)
      .setName(t('settings.archiveFolder'))
      .setDesc(t('settings.archiveFolderDesc'))
      .addText(text => {
        text
          .setPlaceholder('Archive')
          .setValue(this.settings!.maintenanceArchiveFolder)
          .onChange(async (value) => {
            await this.config.updateSettings({ maintenanceArchiveFolder: value || 'Archive' });
          });
      });

    // --- Search (Advanced) ---
    containerEl.createEl('h3', { text: t('settings.search') });

    new Setting(containerEl)
      .setName(t('settings.rrfEmbeddingWeight'))
      .setDesc(t('settings.rrfEmbeddingWeightDesc'))
      .addText(text => {
        text
          .setPlaceholder('2.0')
          .setValue(String(this.settings!.rrfEmbeddingWeight))
          .onChange(async (value) => {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed >= 0.1 && parsed <= 10) {
              await this.config.updateSettings({ rrfEmbeddingWeight: parsed });
            }
          });
      });

    new Setting(containerEl)
      .setName(t('settings.rrfK'))
      .setDesc(t('settings.rrfKDesc'))
      .addText(text => {
        text
          .setPlaceholder('60')
          .setValue(String(this.settings!.rrfK))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 200) {
              await this.config.updateSettings({ rrfK: parsed });
            }
          });
      });

    // --- Privacy ---
    containerEl.createEl('h3', { text: t('settings.privacy') });
    containerEl.createEl('p', {
      text: t('settings.privacyDesc'),
      cls: 'setting-item-description',
    });

    const rulesContainer = containerEl.createDiv();
    this.renderPrivacyRules(rulesContainer);
  }

  private renderPrivacyRules(container: HTMLElement): void {
    container.empty();
    const rules = [...(this.settings?.privacyRules ?? [])] as PrivacyRule[];

    for (let i = 0; i < rules.length; i++) {
      this.renderPrivacyRule(container, rules, i);
    }

    new Setting(container)
      .addButton(btn => {
        btn.setButtonText(t('settings.ruleAdd')).setCta().onClick(async () => {
          const newRule: PrivacyRule = {
            id: crypto.randomUUID(),
            name: '',
            type: 'folder-exclude',
            pattern: '',
            enabled: true,
          };
          rules.push(newRule);
          await this.config.updateSettings({ privacyRules: rules });
          this.settings = await this.config.getSettings();
          this.renderPrivacyRules(container);
        });
      });
  }

  private renderPrivacyRule(container: HTMLElement, rules: PrivacyRule[], index: number): void {
    const rule = rules[index];
    const placeholders: Record<PrivacyRuleType, string> = {
      'folder-exclude': 'Private/',
      'tag-exclude': '#secret',
      'frontmatter-exclude': 'confidential',
      'content-redact': 'password|token',
    };

    const setting = new Setting(container)
      .addText(text => {
        text.setPlaceholder(t('settings.ruleName')).setValue(rule.name).onChange(async (value) => {
          rules[index] = { ...rules[index], name: value };
          await this.config.updateSettings({ privacyRules: rules });
        });
      })
      .addDropdown(dropdown => {
        dropdown
          .addOption('folder-exclude', t('settings.ruleTypeFolderExclude'))
          .addOption('tag-exclude', t('settings.ruleTypeTagExclude'))
          .addOption('frontmatter-exclude', t('settings.ruleTypeFrontmatterExclude'))
          .addOption('content-redact', t('settings.ruleTypeContentRedact'))
          .setValue(rule.type)
          .onChange(async (value) => {
            rules[index] = { ...rules[index], type: value as PrivacyRuleType };
            await this.config.updateSettings({ privacyRules: rules });
          });
      })
      .addText(text => {
        text.setPlaceholder(placeholders[rule.type]).setValue(rule.pattern).onChange(async (value) => {
          rules[index] = { ...rules[index], pattern: value };
          await this.config.updateSettings({ privacyRules: rules });
        });
      })
      .addToggle(toggle => {
        toggle.setValue(rule.enabled).onChange(async (value) => {
          rules[index] = { ...rules[index], enabled: value };
          await this.config.updateSettings({ privacyRules: rules });
        });
      })
      .addExtraButton(btn => {
        btn.setIcon('trash').setTooltip(t('settings.ruleDelete')).onClick(async () => {
          rules.splice(index, 1);
          await this.config.updateSettings({ privacyRules: rules });
          this.settings = await this.config.getSettings();
          this.renderPrivacyRules(container);
        });
      });

    if (!rule.name) {
      setting.setName(t('settings.ruleNumber', { number: index + 1 }));
    } else {
      setting.setName(rule.name);
    }
  }

  private refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE)) {
      const view = leaf.view as { refreshLocale?: () => void };
      view.refreshLocale?.();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(MAINTENANCE_LOG_VIEW_TYPE)) {
      const view = leaf.view as { refresh?: () => Promise<void> };
      view.refresh?.();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(INBOX_STATUS_VIEW_TYPE)) {
      const view = leaf.view as { refresh?: () => Promise<void> };
      view.refresh?.();
    }
  }
}
