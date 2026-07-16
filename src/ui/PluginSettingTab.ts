import { App, Plugin, PluginSettingTab as ObsidianSettingTab, Setting } from 'obsidian';
import { ConfigPort, PluginSettings } from '../application/ports/ConfigPort';
import { PrivacyRule, PrivacyRuleType } from '../domain/models/PrivacyRule';
import { t, setLocale, detectObsidianLocale, type SupportedLocale } from '../i18n';
import { MAINTENANCE_RESULT_VIEW_TYPE, MAINTENANCE_LOG_VIEW_TYPE, ORGANIZE_FOLDER_VIEW_TYPE } from '../constants';

const AI_MODELS: Record<string, ReadonlyArray<{ id: string; label: string }>> = {
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'o3-mini', label: 'o3-mini' },
  ],
  gemini: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
};

const CUSTOM_MODEL_VALUE = '__custom__';

export class PluginSettingTab extends ObsidianSettingTab {
  private settings: PluginSettings | null = null;
  private modelSettingEl: HTMLElement | null = null;
  private modelAnchorEl: HTMLElement | null = null;
  private isCustomMode = false;

  constructor(
    app: App,
    private readonly plugin: Plugin,
    private readonly config: ConfigPort,
    private readonly onMaintenanceSettingsChanged?: () => void,
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
            this.settings = await this.config.getSettings();
            this.isCustomMode = false;
            if (this.modelSettingEl) {
              this.renderModelSetting(this.modelSettingEl.parentElement!);
            }
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

    this.modelAnchorEl = containerEl.createDiv();
    this.modelAnchorEl.addClass('vaultend-model-anchor');
    this.isCustomMode = false;
    this.renderModelSetting(containerEl);

    // --- Organize Folder ---
    containerEl.createEl('h3', { text: t('settings.organize') });

    new Setting(containerEl)
      .setName(t('settings.autoApply'))
      .setDesc(t('settings.autoApplyDesc'))
      .addToggle(toggle => {
        toggle
          .setValue(this.settings!.autoApplyOrganize)
          .onChange(async (value) => {
            await this.config.updateSettings({ autoApplyOrganize: value });
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
    containerEl.createEl('p', {
      text: t('settings.maintenanceScopeNote'),
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName(t('settings.autoMaintenance'))
      .setDesc(t('settings.autoMaintenanceDesc'))
      .addToggle(toggle => {
        toggle
          .setValue(this.settings!.maintenanceEnabled)
          .onChange(async (value) => {
            await this.config.updateSettings({ maintenanceEnabled: value });
            this.onMaintenanceSettingsChanged?.();
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
              this.onMaintenanceSettingsChanged?.();
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

  private renderModelSetting(parentEl: HTMLElement): void {
    if (this.modelSettingEl) {
      this.modelSettingEl.remove();
    }
    this.modelSettingEl = parentEl.createDiv();

    const provider = this.settings!.aiProvider;
    const models = AI_MODELS[provider] ?? [];
    const currentModel = this.settings!.aiModel;
    const isKnownModel = models.some(m => m.id === currentModel);
    const showCustomInput = this.isCustomMode || !isKnownModel;

    const setting = new Setting(this.modelSettingEl)
      .setName(t('settings.model'))
      .setDesc(t('settings.modelDesc'));

    setting.addDropdown(dropdown => {
      for (const model of models) {
        dropdown.addOption(model.id, model.label);
      }
      dropdown.addOption(CUSTOM_MODEL_VALUE, t('settings.modelCustom'));
      dropdown.setValue(showCustomInput ? CUSTOM_MODEL_VALUE : currentModel);
      dropdown.onChange(async (value) => {
        if (value === CUSTOM_MODEL_VALUE) {
          this.isCustomMode = true;
          this.renderModelSetting(parentEl);
          return;
        }
        this.isCustomMode = false;
        await this.config.updateSettings({ aiModel: value });
        this.settings = await this.config.getSettings();
        this.renderModelSetting(parentEl);
      });
    });

    if (showCustomInput) {
      setting.addText(text => {
        text
          .setPlaceholder('model-id')
          .setValue(isKnownModel ? '' : currentModel)
          .onChange(async (value) => {
            await this.config.updateSettings({ aiModel: value });
          });
      });
    }

    if (this.modelAnchorEl && this.modelAnchorEl.parentElement === parentEl) {
      parentEl.insertBefore(this.modelSettingEl, this.modelAnchorEl);
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
    for (const leaf of this.app.workspace.getLeavesOfType(ORGANIZE_FOLDER_VIEW_TYPE)) {
      const view = leaf.view as { refresh?: () => Promise<void> };
      view.refresh?.();
    }
  }
}
