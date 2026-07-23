import { App, Plugin, PluginSettingTab as ObsidianSettingTab, Setting, TFolder } from 'obsidian';
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
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'llama3.1', label: 'Llama 3.1' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'gemma2', label: 'Gemma 2' },
    { id: 'qwen2.5', label: 'Qwen 2.5' },
    { id: 'phi3', label: 'Phi-3' },
  ],
};

const CUSTOM_MODEL_VALUE = '__custom__';

export class PluginSettingTab extends ObsidianSettingTab {
  private settings: PluginSettings | null = null;
  private modelSettingEl: HTMLElement | null = null;
  private modelAnchorEl: HTMLElement | null = null;
  private providerSettingsContainerEl: HTMLElement | null = null;
  private isCustomMode = false;
  private aiConfigDebounceTimer: number | null = null;

  constructor(
    app: App,
    private readonly plugin: Plugin,
    private readonly config: ConfigPort,
    private readonly onMaintenanceSettingsChanged?: () => void,
    private readonly onAIConfigChanged?: () => void,
  ) {
    super(app, plugin);
  }

  private scheduleAIConfigChanged(): void {
    if (this.aiConfigDebounceTimer) window.clearTimeout(this.aiConfigDebounceTimer);
    this.aiConfigDebounceTimer = window.setTimeout(() => {
      this.aiConfigDebounceTimer = null;
      this.onAIConfigChanged?.();
    }, 1500);
  }

  display(): void {
    void this.render();
  }

  private async render(): Promise<void> {
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
            void this.render();
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
          .addOption('ollama', 'Ollama (Local)')
          .addOption('custom', 'Custom (OpenAI-compatible)')
          .setValue(this.settings!.aiProvider)
          .onChange(async (value) => {
            await this.config.updateSettings({
              aiProvider: value as PluginSettings['aiProvider'],
            });
            this.settings = await this.config.getSettings();
            this.isCustomMode = false;
            this.scheduleAIConfigChanged();
            void this.render();
          });
      });

    this.providerSettingsContainerEl = containerEl.createDiv();
    this.renderProviderSettings(this.providerSettingsContainerEl);

    this.modelAnchorEl = containerEl.createDiv();
    this.modelAnchorEl.addClass('vaultend-model-anchor');
    this.isCustomMode = false;
    if (this.settings.aiProvider !== 'custom') {
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
          .onChange(async (value) => {
            await this.config.updateSettings({ aiMaxTokens: value });
          });
      });

    new Setting(containerEl)
      .setDesc(t('settings.truncationNotice'));

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

    // --- Link Suggestion ---
    containerEl.createEl('h3', { text: t('settings.linkSimilarity') });

    new Setting(containerEl)
      .setName(t('settings.linkSimilarityThreshold'))
      .setDesc(
        t('settings.linkSimilarityThresholdDesc')
        + ` (${t('settings.linkSimilarityThreshold')}: ${this.settings.linkSimilarityThreshold.toFixed(2)})`,
      )
      .addSlider(slider => {
        slider
          .setLimits(0.30, 0.80, 0.05)
          .setValue(this.settings!.linkSimilarityThreshold)
          .onChange(async (value) => {
            await this.config.updateSettings({ linkSimilarityThreshold: value });
          });
      });

    // --- Maintenance ---
    containerEl.createEl('h3', { text: t('settings.maintenance') });
    new Setting(containerEl)
      .setDesc(t('settings.maintenanceScopeNote'));

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
      items: [...(this.settings.maintenanceExcludeFolders ?? [])],
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
      items: [...(this.settings.maintenanceExcludeTags ?? [])],
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
    const modelField = 'aiModel';
    const currentModel = this.settings![modelField];
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
        await this.config.updateSettings({ [modelField]: value });
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
            await this.config.updateSettings({ [modelField]: value });
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
    wrapper.createDiv({ text: opts.label, cls: 'setting-item-name' });
    wrapper.createDiv({ text: opts.desc, cls: 'setting-item-description' });

    const chipContainer = wrapper.createDiv({ cls: 'vaultend-chip-container' });

    const renderChips = () => {
      chipContainer.empty();
      for (const item of opts.items) {
        const chip = chipContainer.createDiv({ cls: 'vaultend-chip' });
        chip.createSpan({ text: item });
        const removeBtn = chip.createSpan({ cls: 'vaultend-chip-remove', text: '×' });
        removeBtn.addEventListener('click', () => {
          opts.items.splice(opts.items.indexOf(item), 1);
          void opts.onUpdate(opts.items).then(() => renderChips());
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
    addBtn.addEventListener('click', () => { void addItem(input.value); });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); void addItem(input.value); }
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
        item.addEventListener('click', () => { void addItem(suggestion); });
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => suggestionsEl.addClass('vaultend-hidden'), 200);
    });
  }

  private collectVaultFolders(): string[] {
    const folders: string[] = [];
    const collect = (folder: TFolder) => {
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
        const raw: unknown = cache.frontmatter.tags;
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


  private refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE)) {
      const view = leaf.view as { refreshLocale?: () => void };
      view.refreshLocale?.();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(MAINTENANCE_LOG_VIEW_TYPE)) {
      const view = leaf.view as { refresh?: () => Promise<void> };
      void view.refresh?.();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(ORGANIZE_FOLDER_VIEW_TYPE)) {
      const view = leaf.view as { refresh?: () => Promise<void> };
      void view.refresh?.();
    }
  }
}
