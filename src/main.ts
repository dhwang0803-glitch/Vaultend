import { Plugin, WorkspaceLeaf } from 'obsidian';
import { PluginSettings } from './application/ports/ConfigPort';

// Adapters
import { ObsidianVaultAdapter } from './adapters/vault/ObsidianVaultAdapter';
import { OpenAIAdapter } from './adapters/ai/OpenAIAdapter';
import { GeminiAdapter } from './adapters/ai/GeminiAdapter';
import { JsonSearchIndexAdapter } from './adapters/search/JsonSearchIndexAdapter';
import { FileHistoryAdapter } from './adapters/history/FileHistoryAdapter';
import { ObsidianClipboardAdapter } from './adapters/clipboard/ObsidianClipboardAdapter';
import { SystemClockAdapter } from './adapters/clock/SystemClockAdapter';

// Use Cases
import { QuickAskUseCase } from './application/usecases/QuickAskUseCase';
import { OrganizeNoteUseCase } from './application/usecases/OrganizeNoteUseCase';
import { RunInboxProcessUseCase } from './application/usecases/RunInboxProcessUseCase';
import { RunMaintenanceUseCase } from './application/usecases/RunMaintenanceUseCase';
import { SearchNotesUseCase } from './application/usecases/SearchNotesUseCase';
import { SaveNoteUseCase } from './application/usecases/SaveNoteUseCase';
import { CaptureClipboardUseCase } from './application/usecases/CaptureClipboardUseCase';
import { GetHistoryUseCase } from './application/usecases/GetHistoryUseCase';

// UI
import { QuickAskModal } from './ui/QuickAskModal';
import { MaintenanceLogView, MAINTENANCE_LOG_VIEW_TYPE } from './ui/MaintenanceLogView';
import { InboxStatusView, INBOX_STATUS_VIEW_TYPE } from './ui/InboxStatusView';
import { PluginSettingTab } from './ui/PluginSettingTab';

// Ports
import { AIProviderPort } from './application/ports/AIProviderPort';
import { NotePath, createNotePath } from './domain/values/NotePath';

/**
 * 기본 설정값.
 */
const DEFAULT_SETTINGS: PluginSettings = {
  aiProvider: 'openai',
  aiApiKey: '',
  aiModel: 'gpt-4o',
  aiMaxTokens: 2048,
  aiTemperature: 0.7,
  inboxFolder: 'Inbox',
  autoApplyInbox: false,
  defaultSaveFolder: 'QuickAsk',
  defaultSaveTarget: 'new-note',
  maxContextChunks: 5,
  dailyNoteFormat: 'YYYY-MM-DD',
  dailyNoteFolder: 'DailyNotes',
  maintenanceEnabled: false,
  maintenanceIntervalMinutes: 60,
  privacyRules: [],
  knownTags: [],
  trackTokenUsage: true,
};

export default class KnowledgeMaintenancePlugin extends Plugin {
  declare settings: PluginSettings;

  // Adapters
  private vaultAdapter!: ObsidianVaultAdapter;
  private aiAdapter!: AIProviderPort;
  private searchIndex!: JsonSearchIndexAdapter;
  private historyAdapter!: FileHistoryAdapter;
  private clipboardAdapter!: ObsidianClipboardAdapter;
  private clockAdapter!: SystemClockAdapter;

  // Use Cases
  private quickAskUseCase!: QuickAskUseCase;
  private organizeNoteUseCase!: OrganizeNoteUseCase;
  private runInboxProcessUseCase!: RunInboxProcessUseCase;
  private runMaintenanceUseCase!: RunMaintenanceUseCase;
  private saveNoteUseCase!: SaveNoteUseCase;
  private captureClipboardUseCase!: CaptureClipboardUseCase;
  private getHistoryUseCase!: GetHistoryUseCase;

  // 이벤트 해제 함수
  private unsubscribeVaultEvents: (() => void) | null = null;
  private maintenanceInterval: number | null = null;

  async onload(): Promise<void> {
    console.log('Knowledge Maintenance Plugin: loading');

    // 1. 설정 로드
    await this.loadSettings();

    // 2. 어댑터 초기화
    this.wireAdapters();

    // 3. 유스케이스 초기화
    this.wireUseCases();

    // 4. 뷰 등록
    this.registerViews();

    // 5. 명령 등록
    this.registerCommands();

    // 6. 설정 탭 등록
    this.addSettingTab(new PluginSettingTab(
      this.app,
      this,
      {
        getSettings: async () => this.settings,
        saveSettings: async (s) => { this.settings = s; await this.saveData(s); },
        updateSettings: async (partial) => {
          this.settings = { ...this.settings, ...partial };
          await this.saveData(this.settings);
        },
      },
    ));

    // 7. Vault 이벤트 감시 시작
    this.startInboxWatcher();

    // 8. 자동 유지보수 스케줄링
    this.scheduleMaintenanceIfEnabled();

    // 9. 앱 열림 시 Catch-up (마지막 실행 이후 변경된 Inbox 노트 처리)
    this.app.workspace.onLayoutReady(() => {
      this.runCatchUp();
    });
  }

  onunload(): void {
    console.log('Knowledge Maintenance Plugin: unloading');

    // 이벤트 감시 해제
    if (this.unsubscribeVaultEvents) {
      this.unsubscribeVaultEvents();
      this.unsubscribeVaultEvents = null;
    }

    // 유지보수 타이머 해제
    if (this.maintenanceInterval !== null) {
      window.clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
  }

  // ─── 내부 메서드 ───

  private async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  private wireAdapters(): void {
    this.vaultAdapter = new ObsidianVaultAdapter(this.app);
    this.searchIndex = new JsonSearchIndexAdapter(this.vaultAdapter);
    this.historyAdapter = new FileHistoryAdapter(this.vaultAdapter);
    this.clipboardAdapter = new ObsidianClipboardAdapter();
    this.clockAdapter = new SystemClockAdapter();

    // AI 어댑터는 설정에 따라 동적 선택
    this.aiAdapter = this.createAIAdapter();
  }

  private createAIAdapter(): AIProviderPort {
    switch (this.settings.aiProvider) {
      case 'openai':
        return new OpenAIAdapter(this.settings.aiApiKey, this.settings.aiModel);
      case 'gemini':
        return new GeminiAdapter(this.settings.aiApiKey, this.settings.aiModel);
      default:
        return new OpenAIAdapter(this.settings.aiApiKey, this.settings.aiModel);
    }
  }

  private wireUseCases(): void {
    const configPort = {
      getSettings: async () => this.settings,
      saveSettings: async (s: PluginSettings) => { this.settings = s; await this.saveData(s); },
      updateSettings: async (partial: Partial<PluginSettings>) => {
        this.settings = { ...this.settings, ...partial };
        await this.saveData(this.settings);
      },
    };

    this.saveNoteUseCase = new SaveNoteUseCase(
      this.vaultAdapter, configPort, this.clockAdapter,
    );

    this.quickAskUseCase = new QuickAskUseCase(
      this.aiAdapter, this.vaultAdapter, this.searchIndex,
      this.historyAdapter, configPort, this.clockAdapter,
      this.saveNoteUseCase,
    );

    this.organizeNoteUseCase = new OrganizeNoteUseCase(
      this.aiAdapter, this.vaultAdapter,
      this.historyAdapter, configPort,
    );

    this.runInboxProcessUseCase = new RunInboxProcessUseCase(
      this.organizeNoteUseCase, this.vaultAdapter,
      configPort, this.historyAdapter, this.clockAdapter,
    );

    this.runMaintenanceUseCase = new RunMaintenanceUseCase(
      this.vaultAdapter, this.searchIndex,
      configPort, this.clockAdapter,
    );

    this.captureClipboardUseCase = new CaptureClipboardUseCase(
      this.clipboardAdapter, this.saveNoteUseCase,
      configPort, this.historyAdapter, this.clockAdapter,
    );

    this.getHistoryUseCase = new GetHistoryUseCase(this.historyAdapter);
  }

  private registerViews(): void {
    this.registerView(
      MAINTENANCE_LOG_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MaintenanceLogView(leaf, this.getHistoryUseCase),
    );

    this.registerView(
      INBOX_STATUS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new InboxStatusView(leaf, this.vaultAdapter, {
        getSettings: async () => this.settings,
        saveSettings: async () => {},
        updateSettings: async () => {},
      }),
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'quick-ask',
      name: 'Quick Ask',
      callback: () => {
        new QuickAskModal(
          this.app,
          this.quickAskUseCase,
          { kind: this.settings.defaultSaveTarget === 'daily-note' ? 'daily-note' : 'new-note' as any,
            title: '' as any, position: 'bottom' },
        ).open();
      },
    });

    this.addCommand({
      id: 'capture-clipboard',
      name: '클립보드 캡처',
      callback: async () => {
        try {
          const path = await this.captureClipboardUseCase.execute();
          // Notice는 Obsidian API이므로 UI 계층에서 사용 가능
          const { Notice } = await import('obsidian');
          new Notice(`클립보드 내용을 저장했습니다: ${path}`);
        } catch (err) {
          const { Notice } = await import('obsidian');
          new Notice(`클립보드 캡처 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    this.addCommand({
      id: 'organize-current-note',
      name: '현재 노트 정리',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;
        if (checking) return true;

        this.organizeNoteUseCase
          .execute(createNotePath(activeFile.path), false)
          .then(result => {
            const { Notice } = require('obsidian');
            new Notice(`분류: ${result.classifiedCategory} | 태그: ${result.addedTags.join(', ')}`);
          })
          .catch(err => {
            const { Notice } = require('obsidian');
            new Notice(`노트 정리 실패: ${err.message}`);
          });
      },
    });

    this.addCommand({
      id: 'run-maintenance',
      name: '유지보수 실행',
      callback: async () => {
        const { Notice } = await import('obsidian');
        new Notice('유지보수 스캔을 시작합니다...');
        try {
          const plan = await this.runMaintenanceUseCase.execute();
          new Notice(
            `유지보수 완료: 고아 노트 ${plan.orphanNotes.length}개, ` +
            `중복 후보 ${plan.duplicateCandidates.length}쌍, ` +
            `깨진 링크 ${plan.brokenLinks.length}개`,
          );
        } catch (err) {
          new Notice(`유지보수 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    this.addCommand({
      id: 'run-inbox-process',
      name: 'Inbox 처리',
      callback: async () => {
        const { Notice } = await import('obsidian');
        new Notice('Inbox 처리를 시작합니다...');
        try {
          const result = await this.runInboxProcessUseCase.execute();
          new Notice(
            `Inbox 처리 완료: ${result.processedCount}개 처리, ` +
            `${result.skippedCount}개 건너뜀, ${result.errors.length}개 오류`,
          );
        } catch (err) {
          new Notice(`Inbox 처리 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    this.addCommand({
      id: 'open-maintenance-log',
      name: '유지보수 로그 열기',
      callback: () => this.activateView(MAINTENANCE_LOG_VIEW_TYPE),
    });

    this.addCommand({
      id: 'open-inbox-status',
      name: 'Inbox 상태 열기',
      callback: () => this.activateView(INBOX_STATUS_VIEW_TYPE),
    });
  }

  private async activateView(viewType: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private startInboxWatcher(): void {
    // 섹션 12에서 상세 설명
  }

  private scheduleMaintenanceIfEnabled(): void {
    // 섹션 12에서 상세 설명
  }

  private async runCatchUp(): Promise<void> {
    // 앱 시작 시 미처리 Inbox 노트 처리
    try {
      await this.runInboxProcessUseCase.execute();
    } catch (err) {
      console.error('Knowledge Maintenance: catch-up 실패', err);
    }
  }
}
