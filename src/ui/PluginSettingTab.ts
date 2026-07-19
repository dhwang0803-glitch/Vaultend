import { App, Notice, Plugin, PluginSettingTab as ObsidianSettingTab, Setting } from 'obsidian';
import { ConfigPort, PluginSettings } from '../application/ports/ConfigPort';
import type { LicensePort } from '../application/ports/LicensePort';
import type { PreferencePort } from '../application/ports/PreferencePort';
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
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'llama3.1', label: 'Llama 3.1' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'gemma2', label: 'Gemma 2' },
    { id: 'qwen2.5', label: 'Qwen 2.5' },
    { id: 'phi3', label: 'Phi-3' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

const CUSTOM_MODEL_VALUE = '__custom__';

export class PluginSettingTab extends ObsidianSettingTab {
  private settings: PluginSettings | null = null;
  private modelSettingEl: HTMLElement | null = null;
  private modelAnchorEl: HTMLElement | null = null;
  private providerSettingsContainerEl: HTMLElement | null = null;
  private isCustomMode = false;
  private aiConfigDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    app: App,
    private readonly plugin: Plugin,
    private readonly config: ConfigPort,
    private readonly licensePort: LicensePort,
    private readonly onMaintenanceSettingsChanged?: () => void,
    private readonly preference?: PreferencePort,
    private readonly onAIConfigChanged?: () => void,
  ) {
    super(app, plugin);
  }

  private scheduleAIConfigChanged(): void {
    if (this.aiConfigDebounceTimer) clearTimeout(this.aiConfigDebounceTimer);
    this.aiConfigDebounceTimer = setTimeout(() => {
      this.aiConfigDebounceTimer = null;
      this.onAIConfigChanged?.();
    }, 1500);
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

    // --- License ---
    await this.renderLicenseSection(containerEl);

    // --- AI Provider ---
    containerEl.createEl('h3', { text: t('settings.aiProvider') });

    new Setting(containerEl)
      .setName(t('settings.aiProviderName'))
      .setDesc(t('settings.aiProviderDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('gemini', 'Google Gemini')
          .addOption('ollama', 'Ollama (Local)')
          .addOption('deepseek', 'DeepSeek')
          .addOption('custom', 'Custom (OpenAI-compatible)')
          .setValue(this.settings!.aiProvider)
          .onChange(async (value) => {
            await this.config.updateSettings({
              aiProvider: value as PluginSettings['aiProvider'],
            });
            this.settings = await this.config.getSettings();
            this.isCustomMode = false;
            this.scheduleAIConfigChanged();
            this.display();
          });
      });

    this.providerSettingsContainerEl = containerEl.createDiv();
    this.renderProviderSettings(this.providerSettingsContainerEl);

    this.modelAnchorEl = containerEl.createDiv();
    this.modelAnchorEl.addClass('vaultend-model-anchor');
    this.isCustomMode = false;
    if (this.settings.aiProvider === 'openai' || this.settings.aiProvider === 'gemini') {
      this.renderModelSetting(containerEl);
    }

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
      .setDesc(t('settings.maintenanceScopeNote'));

    const licenseStatus = await this.licensePort.getStatus();
    const isPro = licenseStatus.tier === 'pro'
      || (this.settings!.proGraceDeadline > 0 && Date.now() < this.settings!.proGraceDeadline);

    const autoMaintenanceSetting = new Setting(containerEl)
      .setName(t('settings.autoMaintenance'))
      .setDesc(t('settings.autoMaintenanceDesc'));

    if (!isPro) {
      autoMaintenanceSetting.nameEl.createSpan({ text: ' PRO', cls: 'vaultend-pro-badge' });
      autoMaintenanceSetting.addToggle(toggle => {
        toggle.setValue(false).setDisabled(true);
      });
    } else {
      autoMaintenanceSetting.addToggle(toggle => {
        toggle
          .setValue(this.settings!.maintenanceEnabled)
          .onChange(async (value) => {
            await this.config.updateSettings({ maintenanceEnabled: value });
            this.onMaintenanceSettingsChanged?.();
          });
      });
    }

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
      .setName(t('settings.rejectDecayDays'))
      .setDesc(t('settings.rejectDecayDaysDesc'))
      .addText(text => {
        text
          .setPlaceholder('7')
          .setValue(String(this.settings!.rejectDecayDays))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 1) {
              await this.config.updateSettings({ rejectDecayDays: parsed });
            }
          });
      });

    this.renderChipSetting(containerEl, {
      label: t('settings.excludeFolders'),
      desc: t('settings.excludeFoldersDesc'),
      items: [...(this.settings!.maintenanceExcludeFolders ?? [])],
      placeholder: t('settings.excludeFoldersPlaceholder'),
      suggestions: () => this.collectVaultFolders(),
      onUpdate: async (items) => {
        const cleaned = items.map(s => s.replace(/\/+$/, ''));
        await this.config.updateSettings({ maintenanceExcludeFolders: cleaned });
      },
    });

    this.renderChipSetting(containerEl, {
      label: t('settings.excludeTags'),
      desc: t('settings.excludeTagsDesc'),
      items: [...(this.settings!.maintenanceExcludeTags ?? [])],
      placeholder: t('settings.excludeTagsPlaceholder'),
      suggestions: () => this.collectVaultTags(),
      onUpdate: async (items) => {
        await this.config.updateSettings({ maintenanceExcludeTags: items });
      },
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
    new Setting(containerEl)
      .setDesc(t('settings.privacyDesc'));

    const rulesContainer = containerEl.createDiv();
    this.renderPrivacyRules(rulesContainer);

    // --- AI Learning ---
    if (this.preference) {
      containerEl.createEl('h3', { text: t('settings.aiLearning') });
      new Setting(containerEl)
        .setDesc(t('settings.aiLearningDesc'));

      const learningContainer = containerEl.createDiv();
      this.renderAILearningSection(learningContainer);
    }
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
    setting.settingEl.addClass('vaultend-privacy-rule');
  }

  private async renderAILearningSection(container: HTMLElement): Promise<void> {
    container.empty();

    const ruleSet = await this.preference!.load();
    const hasRules = ruleSet && ruleSet.rules.length > 0;

    if (!hasRules) {
      container.createEl('p', {
        text: t('settings.aiLearningEmpty'),
        cls: 'setting-item-description',
      });
    } else {
      container.createEl('p', {
        text: t('settings.aiLearningStats', {
          ruleCount: ruleSet.rules.length,
          signalCount: ruleSet.signals.length,
        }),
        cls: 'setting-item-description',
      });

      const manualRules = ruleSet.rules.filter(r => r.source === 'manual');
      const learnedRules = ruleSet.rules.filter(r => r.source !== 'manual');

      for (const rule of [...manualRules, ...learnedRules]) {
        const actionLabel = rule.action === 'approved'
          ? t('settings.aiLearningRuleApproved')
          : t('settings.aiLearningRuleRejected');
        const sourceLabel = rule.source === 'manual'
          ? t('settings.aiLearningRuleManual')
          : t('settings.aiLearningRuleLearned');
        const hitInfo = rule.source === 'manual' ? '' : ` (×${rule.hitCount})`;
        const display = `${actionLabel}: ${rule.pattern}${hitInfo}`;

        new Setting(container)
          .setName(display)
          .setDesc(sourceLabel)
          .addExtraButton(btn => {
            btn.setIcon('trash')
              .setTooltip(t('settings.aiLearningDelete'))
              .onClick(async () => {
                await this.preference!.deleteRule(rule.id);
                this.renderAILearningSection(container);
              });
          });
      }
    }

    const licenseStatus = await this.licensePort.getStatus();
    const isPro = licenseStatus.tier === 'pro'
      || (this.settings!.proGraceDeadline > 0 && Date.now() < this.settings!.proGraceDeadline);

    if (isPro) {
      this.renderManualRuleForm(container);
    } else {
      const addSetting = new Setting(container)
        .setName(t('settings.aiLearningAddRule'));
      addSetting.nameEl.createSpan({ text: ' PRO', cls: 'vaultend-pro-badge' });
      addSetting.addButton(btn => btn.setButtonText(t('settings.aiLearningAddRule')).setDisabled(true));
    }

    if (hasRules) {
      new Setting(container)
        .addButton(btn => {
          btn.setButtonText(t('settings.aiLearningResetAll'))
            .setWarning()
            .onClick(async () => {
              await this.preference!.resetAll();
              new Notice(t('settings.aiLearningResetConfirm'));
              this.renderAILearningSection(container);
            });
        });
    }

    await this.renderSuppressionsSection(container);
  }

  private async renderSuppressionsSection(container: HTMLElement): Promise<void> {
    if (!this.preference) return;
    const suppressions = await this.preference.getSuppressions();
    if (suppressions.length === 0) return;

    container.createEl('h4', { text: t('settings.suppressionsTitle') });
    container.createEl('p', {
      text: t('settings.suppressionsDesc'),
      cls: 'setting-item-description',
    });

    const now = Date.now();
    for (const entry of suppressions) {
      const remaining = Math.max(0, Math.ceil((entry.expiresAt - now) / 86_400_000));
      const desc = remaining > 0
        ? t('settings.suppressionExpires', { days: remaining })
        : t('settings.suppressionExpired');

      new Setting(container)
        .setName(entry.label)
        .setDesc(desc)
        .addExtraButton(btn => {
          btn.setIcon('x')
            .setTooltip(t('settings.suppressionRemove'))
            .onClick(async () => {
              await this.preference!.unsuppress(entry.id);
              this.renderAILearningSection(container);
            });
        });
    }
  }

  private renderManualRuleForm(container: HTMLElement): void {
    const formEl = container.createDiv({ cls: 'vaultend-manual-rule-form' });

    let selectedType: 'exclusion' | 'folder-routing' | 'tag-mapping' = 'exclusion';
    let selectedAction: 'approved' | 'rejected' = 'rejected';
    let inputFrom = '';
    let inputTo = '';

    const dynamicEl = formEl.createDiv();

    const rebuildInputs = () => {
      dynamicEl.empty();

      if (selectedType !== 'exclusion') {
        new Setting(dynamicEl)
          .setName(selectedType === 'folder-routing'
            ? t('settings.aiLearningActionAlways') + ' / ' + t('settings.aiLearningActionNever')
            : t('settings.aiLearningActionAlways') + ' / ' + t('settings.aiLearningActionNever'))
          .addDropdown(dd => {
            dd.addOption('approved', t('settings.aiLearningActionAlways'))
              .addOption('rejected', t('settings.aiLearningActionNever'))
              .setValue(selectedAction)
              .onChange(v => { selectedAction = v as 'approved' | 'rejected'; });
          });
      }

      if (selectedType === 'exclusion') {
        new Setting(dynamicEl)
          .setName(t('settings.aiLearningPatternFolder'))
          .addText(text => {
            text.setPlaceholder('Templates').onChange(v => { inputFrom = v; });
          });
      } else {
        new Setting(dynamicEl)
          .setName(t('settings.aiLearningPatternFrom'))
          .addText(text => {
            const ph = selectedType === 'folder-routing' ? 'Notes' : '#wip';
            text.setPlaceholder(ph).onChange(v => { inputFrom = v; });
          });
        new Setting(dynamicEl)
          .setName(t('settings.aiLearningPatternTo'))
          .addText(text => {
            const ph = selectedType === 'folder-routing' ? 'Projects' : '#draft';
            text.setPlaceholder(ph).onChange(v => { inputTo = v; });
          });
      }
    };

    new Setting(formEl)
      .setName(t('settings.aiLearningAddRule'))
      .setDesc(t('settings.aiLearningAddRuleDesc'))
      .addDropdown(dd => {
        dd.addOption('exclusion', t('settings.aiLearningRuleTypeExclusion'))
          .addOption('folder-routing', t('settings.aiLearningRuleTypeFolderRouting'))
          .addOption('tag-mapping', t('settings.aiLearningRuleTypeTagMapping'))
          .setValue(selectedType)
          .onChange(v => {
            selectedType = v as typeof selectedType;
            selectedAction = v === 'exclusion' ? 'rejected' : 'approved';
            inputFrom = '';
            inputTo = '';
            rebuildInputs();
          });
      });

    rebuildInputs();

    new Setting(formEl)
      .addButton(btn => {
        btn.setButtonText(t('settings.aiLearningAddRule'))
          .setCta()
          .onClick(async () => {
            const from = inputFrom.trim();
            if (!from) return;

            let pattern: string;
            let action = selectedAction;

            switch (selectedType) {
              case 'exclusion':
                pattern = `exclude:${from}/*`;
                action = 'rejected';
                break;
              case 'folder-routing': {
                const to = inputTo.trim();
                if (!to) return;
                pattern = `folder:${from}→${to}`;
                break;
              }
              case 'tag-mapping': {
                const to = inputTo.trim();
                if (!to) return;
                pattern = `tag:${from}→${to}`;
                break;
              }
            }

            await this.preference!.addManualRule(selectedType, pattern, action);
            new Notice(t('settings.aiLearningRuleAdded'));
            this.renderAILearningSection(container);
          });
      });
  }

  private renderProviderSettings(containerEl: HTMLElement): void {
    containerEl.empty();
    const provider = this.settings!.aiProvider;

    if (provider === 'openai' || provider === 'gemini') {
      new Setting(containerEl)
        .setName(t('settings.apiKey'))
        .setDesc(t('settings.apiKeyDesc'))
        .addText(text => {
          text
            .setPlaceholder('sk-...')
            .setValue(this.settings!.aiApiKey)
            .onChange(async (value) => {
              await this.config.updateSettings({ aiApiKey: value });
              this.scheduleAIConfigChanged();
            });
          text.inputEl.type = 'password';
        });
    }

    if (provider === 'ollama') {
      new Setting(containerEl)
        .setName(t('settings.ollamaBaseUrl'))
        .setDesc(t('settings.ollamaBaseUrlDesc'))
        .addText(text => {
          text
            .setPlaceholder('http://localhost:11434')
            .setValue(this.settings!.ollamaBaseUrl)
            .onChange(async (value) => {
              await this.config.updateSettings({ ollamaBaseUrl: value });
              this.scheduleAIConfigChanged();
            });
        });
      new Setting(containerEl)
        .setName(t('settings.model'))
        .setDesc(t('settings.modelDesc'))
        .addText(text => {
          text
            .setPlaceholder('llama3.2')
            .setValue(this.settings!.aiModel || 'llama3.2')
            .onChange(async (value) => {
              await this.config.updateSettings({ aiModel: value });
              this.scheduleAIConfigChanged();
            });
        });
    }

    if (provider === 'deepseek') {
      new Setting(containerEl)
        .setName(t('settings.deepseekApiKey'))
        .setDesc(t('settings.deepseekApiKeyDesc'))
        .addText(text => {
          text
            .setPlaceholder('sk-...')
            .setValue(this.settings!.deepseekApiKey)
            .onChange(async (value) => {
              await this.config.updateSettings({ deepseekApiKey: value });
              this.scheduleAIConfigChanged();
            });
          text.inputEl.type = 'password';
        });
      new Setting(containerEl)
        .setName(t('settings.deepseekModel'))
        .setDesc(t('settings.deepseekModelDesc'))
        .addText(text => {
          text
            .setPlaceholder('deepseek-chat')
            .setValue(this.settings!.deepseekModel)
            .onChange(async (value) => {
              await this.config.updateSettings({ deepseekModel: value });
              this.scheduleAIConfigChanged();
            });
        });
    }

    if (provider === 'custom') {
      new Setting(containerEl)
        .setName(t('settings.customBaseUrl'))
        .setDesc(t('settings.customBaseUrlDesc'))
        .addText(text => {
          text
            .setPlaceholder('http://localhost:1234')
            .setValue(this.settings!.customBaseUrl)
            .onChange(async (value) => {
              await this.config.updateSettings({ customBaseUrl: value });
              this.scheduleAIConfigChanged();
            });
        });
      new Setting(containerEl)
        .setName(t('settings.customApiKey'))
        .setDesc(t('settings.customApiKeyDesc'))
        .addText(text => {
          text
            .setPlaceholder('(optional)')
            .setValue(this.settings!.customApiKey)
            .onChange(async (value) => {
              await this.config.updateSettings({ customApiKey: value });
              this.scheduleAIConfigChanged();
            });
          text.inputEl.type = 'password';
        });
      new Setting(containerEl)
        .setName(t('settings.customModel'))
        .setDesc(t('settings.customModelDesc'))
        .addText(text => {
          text
            .setPlaceholder('model-name')
            .setValue(this.settings!.customModel)
            .onChange(async (value) => {
              await this.config.updateSettings({ customModel: value });
              this.scheduleAIConfigChanged();
            });
        });
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
        this.scheduleAIConfigChanged();
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
            this.scheduleAIConfigChanged();
          });
      });
    }

    if (this.modelAnchorEl && this.modelAnchorEl.parentElement === parentEl) {
      parentEl.insertBefore(this.modelSettingEl, this.modelAnchorEl);
    }
  }

  private renderChipSetting(
    containerEl: HTMLElement,
    opts: {
      label: string;
      desc: string;
      items: string[];
      placeholder: string;
      suggestions: () => string[];
      onUpdate: (items: string[]) => Promise<void>;
    },
  ): void {
    const wrapper = containerEl.createDiv({ cls: 'setting-item vaultend-chip-setting' });
    wrapper.createEl('div', { text: opts.label, cls: 'setting-item-name' });
    wrapper.createEl('div', { text: opts.desc, cls: 'setting-item-description' });

    const chipContainer = wrapper.createDiv({ cls: 'vaultend-chip-container' });

    const renderChips = () => {
      chipContainer.empty();
      for (const item of opts.items) {
        const chip = chipContainer.createDiv({ cls: 'vaultend-chip' });
        chip.createSpan({ text: item });
        const removeBtn = chip.createSpan({ cls: 'vaultend-chip-remove', text: '×' });
        removeBtn.addEventListener('click', async () => {
          opts.items.splice(opts.items.indexOf(item), 1);
          await opts.onUpdate(opts.items);
          renderChips();
        });
      }
    };

    renderChips();

    const inputRow = wrapper.createDiv({ cls: 'vaultend-chip-input-row' });
    const input = inputRow.createEl('input', {
      type: 'text',
      placeholder: opts.placeholder,
      cls: 'vaultend-chip-input',
    });

    const suggestionsEl = wrapper.createDiv({ cls: 'vaultend-chip-suggestions' });
    suggestionsEl.addClass('vaultend-hidden');

    const addItem = async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || opts.items.includes(trimmed)) return;
      opts.items.push(trimmed);
      await opts.onUpdate(opts.items);
      input.value = '';
      suggestionsEl.addClass('vaultend-hidden');
      renderChips();
    };

    const addBtn = inputRow.createEl('button', { text: t('settings.chipAdd'), cls: 'vaultend-chip-add-btn' });
    addBtn.addEventListener('click', () => addItem(input.value));
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); addItem(input.value); }
    });

    const cachedSuggestions = opts.suggestions();

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      const filtered = cachedSuggestions.filter(s =>
        !opts.items.includes(s) && s.toLowerCase().includes(query),
      ).slice(0, 10);

      suggestionsEl.empty();
      if (filtered.length === 0 || !query) {
        suggestionsEl.addClass('vaultend-hidden');
        return;
      }
      suggestionsEl.removeClass('vaultend-hidden');
      for (const suggestion of filtered) {
        const item = suggestionsEl.createDiv({ cls: 'vaultend-chip-suggestion-item', text: suggestion });
        item.addEventListener('click', () => addItem(suggestion));
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => suggestionsEl.addClass('vaultend-hidden'), 200);
    });
  }

  private collectVaultFolders(): string[] {
    const { TFolder } = require('obsidian');
    const folders: string[] = [];
    const collect = (folder: InstanceType<typeof TFolder>) => {
      if (folder.path) folders.push(folder.path);
      for (const child of folder.children ?? []) {
        if (child instanceof TFolder) collect(child);
      }
    };
    collect(this.app.vault.getRoot());
    return folders.sort();
  }

  private collectVaultTags(): string[] {
    const tags = new Map<string, number>();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      if (cache.tags) {
        for (const t of cache.tags) {
          const tag = t.tag;
          tags.set(tag, (tags.get(tag) ?? 0) + 1);
        }
      }
      if (cache.frontmatter?.tags) {
        const raw = cache.frontmatter.tags;
        const list = Array.isArray(raw) ? raw : [raw];
        for (const item of list) {
          const s = String(item);
          const tag = s.startsWith('#') ? s : `#${s}`;
          tags.set(tag, (tags.get(tag) ?? 0) + 1);
        }
      }
    }
    return [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }

  private async renderLicenseSection(containerEl: HTMLElement): Promise<void> {
    containerEl.createEl('h3', { text: t('settings.license') });

    const licenseStatus = await this.licensePort.getStatus();
    const isGracePeriod = this.settings!.proGraceDeadline > 0
      && Date.now() < this.settings!.proGraceDeadline
      && licenseStatus.tier !== 'pro';

    const licenseSetting = new Setting(containerEl)
      .setName(t('settings.licenseKey'))
      .setDesc(licenseStatus.tier === 'pro'
        ? t('settings.licenseActive')
        : t('settings.licenseInactive'));

    let keyInput: HTMLInputElement | null = null;
    licenseSetting.addText(text => {
      text
        .setPlaceholder('VE-XXXX-XXXX-XXXX-XXXX')
        .setValue(this.settings!.licenseKey ?? '');
      text.inputEl.type = 'password';
      keyInput = text.inputEl;
    });

    if (licenseStatus.tier === 'pro') {
      licenseSetting.addButton(btn => btn
        .setButtonText(t('settings.licenseDeactivate'))
        .onClick(async () => {
          await this.licensePort.deactivate();
          this.display();
        }),
      );
    } else {
      licenseSetting.addButton(btn => btn
        .setButtonText(t('settings.licenseActivate'))
        .setCta()
        .onClick(async () => {
          const key = keyInput?.value ?? '';
          const result = await this.licensePort.activate(key);
          if (result.tier === 'pro') {
            new Notice(t('settings.licenseActivated'));
            this.onMaintenanceSettingsChanged?.();
          } else {
            new Notice(t('settings.licenseInvalid'));
          }
          this.display();
        }),
      );
    }

    const badge = containerEl.createDiv({
      cls: licenseStatus.tier === 'pro'
        ? 'vaultend-license-badge vaultend-pro-active'
        : 'vaultend-license-badge vaultend-free',
    });
    badge.textContent = licenseStatus.tier === 'pro'
      ? t('settings.licensePro')
      : t('settings.licenseFree');

    if (isGracePeriod) {
      const daysLeft = Math.ceil(
        (this.settings!.proGraceDeadline - Date.now()) / (24 * 60 * 60 * 1000),
      );
      containerEl.createEl('p', {
        text: t('settings.gracePeriod', { days: daysLeft }),
        cls: 'vaultend-grace-notice',
      });
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
