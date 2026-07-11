import { App, Plugin, PluginSettingTab as ObsidianSettingTab, Setting } from 'obsidian';
import { ConfigPort, PluginSettings } from '../application/ports/ConfigPort';
import { PrivacyRule, PrivacyRuleType } from '../domain/models/PrivacyRule';

/**
 * 플러그인 설정 탭 — AI 공급자, Inbox 폴더, 프라이버시 규칙 등을 설정한다.
 */
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

    containerEl.createEl('h2', { text: 'Knowledge Maintenance 설정' });

    // --- AI 공급자 설정 ---
    containerEl.createEl('h3', { text: 'AI 공급자' });

    new Setting(containerEl)
      .setName('AI 공급자')
      .setDesc('사용할 AI 서비스를 선택합니다.')
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
      .setName('API 키')
      .setDesc('AI 공급자의 API 키를 입력합니다.')
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
      .setName('모델')
      .setDesc('사용할 AI 모델을 입력합니다.')
      .addText(text => {
        text
          .setPlaceholder('gpt-4o')
          .setValue(this.settings!.aiModel)
          .onChange(async (value) => {
            await this.config.updateSettings({ aiModel: value });
          });
      });

    // --- Inbox 설정 ---
    containerEl.createEl('h3', { text: 'Inbox' });

    new Setting(containerEl)
      .setName('Inbox 폴더')
      .setDesc('미처리 노트가 수집되는 폴더 경로')
      .addText(text => {
        text
          .setPlaceholder('Inbox')
          .setValue(this.settings!.inboxFolder)
          .onChange(async (value) => {
            await this.config.updateSettings({ inboxFolder: value });
          });
      });

    new Setting(containerEl)
      .setName('자동 적용')
      .setDesc('Inbox 처리 결과를 자동으로 적용합니다.')
      .addToggle(toggle => {
        toggle
          .setValue(this.settings!.autoApplyInbox)
          .onChange(async (value) => {
            await this.config.updateSettings({ autoApplyInbox: value });
          });
      });

    // --- Quick Ask 설정 ---
    containerEl.createEl('h3', { text: 'Quick Ask' });

    new Setting(containerEl)
      .setName('저장 모드')
      .setDesc('Quick Ask 답변의 저장 방식을 선택합니다.')
      .addDropdown(dropdown => {
        dropdown
          .addOption('timestamp', '타임스탬프 파일명 (질문마다 별도 파일)')
          .addOption('daily-note', 'Daily Note (하루치를 하나의 파일에 추가)')
          .setValue(this.settings!.quickAskSaveMode)
          .onChange(async (value) => {
            await this.config.updateSettings({
              quickAskSaveMode: value as 'timestamp' | 'daily-note',
            });
          });
      });

    new Setting(containerEl)
      .setName('Daily Note 용량 제한 (KB)')
      .setDesc('Daily Note 모드에서 파일이 이 크기를 초과하면 새 파일을 생성합니다.')
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

    // --- 유지보수 설정 ---
    containerEl.createEl('h3', { text: '유지보수' });

    new Setting(containerEl)
      .setName('자동 유지보수')
      .setDesc('주기적으로 Vault 유지보수를 실행합니다.')
      .addToggle(toggle => {
        toggle
          .setValue(this.settings!.maintenanceEnabled)
          .onChange(async (value) => {
            await this.config.updateSettings({ maintenanceEnabled: value });
          });
      });

    new Setting(containerEl)
      .setName('유지보수 주기 (분)')
      .setDesc('자동 유지보수 실행 간격')
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
      .setName('스캔 제외 폴더')
      .setDesc('유지보수 스캔에서 제외할 폴더 (쉼표로 구분)')
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
      .setName('스캔 제외 파일 패턴')
      .setDesc('유지보수 스캔에서 제외할 파일 패턴 (쉼표로 구분, glob 지원)')
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
      .setName('스캔 제외 태그')
      .setDesc('이 태그가 있는 노트를 유지보수 스캔에서 제외합니다 (쉼표로 구분)')
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
      .setName('아카이브 폴더')
      .setDesc('노트 아카이브 시 이동할 대상 폴더')
      .addText(text => {
        text
          .setPlaceholder('Archive')
          .setValue(this.settings!.maintenanceArchiveFolder)
          .onChange(async (value) => {
            await this.config.updateSettings({ maintenanceArchiveFolder: value || 'Archive' });
          });
      });

    // --- 프라이버시 ---
    containerEl.createEl('h3', { text: '프라이버시' });
    containerEl.createEl('p', {
      text: '아래 규칙에 해당하는 노트는 AI에게 전송되지 않습니다.',
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
        btn.setButtonText('규칙 추가').setCta().onClick(async () => {
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
        text.setPlaceholder('규칙 이름').setValue(rule.name).onChange(async (value) => {
          rules[index] = { ...rules[index], name: value };
          await this.config.updateSettings({ privacyRules: rules });
        });
      })
      .addDropdown(dropdown => {
        dropdown
          .addOption('folder-exclude', '폴더 제외')
          .addOption('tag-exclude', '태그 제외')
          .addOption('frontmatter-exclude', 'Frontmatter 제외')
          .addOption('content-redact', '내용 마스킹')
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
        btn.setIcon('trash').setTooltip('삭제').onClick(async () => {
          rules.splice(index, 1);
          await this.config.updateSettings({ privacyRules: rules });
          this.settings = await this.config.getSettings();
          this.renderPrivacyRules(container);
        });
      });

    if (!rule.name) {
      setting.setName(`규칙 ${index + 1}`);
    } else {
      setting.setName(rule.name);
    }
  }
}
