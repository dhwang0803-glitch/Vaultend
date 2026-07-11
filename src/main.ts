import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
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
import { SaveNoteUseCase } from './application/usecases/SaveNoteUseCase';
import { CaptureClipboardUseCase } from './application/usecases/CaptureClipboardUseCase';
import { GetHistoryUseCase } from './application/usecases/GetHistoryUseCase';
import { ApplyMaintenanceActionUseCase } from './application/usecases/ApplyMaintenanceActionUseCase';

// UI
import { QuickAskModal } from './ui/QuickAskModal';
import { MaintenanceLogView, MAINTENANCE_LOG_VIEW_TYPE } from './ui/MaintenanceLogView';
import { MaintenanceResultView, MAINTENANCE_RESULT_VIEW_TYPE } from './ui/MaintenanceResultView';
import { InboxStatusView, INBOX_STATUS_VIEW_TYPE } from './ui/InboxStatusView';
import { PluginSettingTab } from './ui/PluginSettingTab';

// Ports
import { AIProviderPort } from './application/ports/AIProviderPort';
import { ConfigPort } from './application/ports/ConfigPort';
import { VaultEvent } from './application/ports/VaultAccessPort';
import { NotePath, createNotePath } from './domain/values/NotePath';
import { SaveTarget } from './domain/models/SaveTarget';
import { createNoteTitle } from './domain/values/NoteTitle';
import {
  INBOX_DEBOUNCE_MS,
  DEFAULT_INBOX_FOLDER,
  DEFAULT_SAVE_FOLDER,
  DEFAULT_DAILY_NOTE_FOLDER,
  DEFAULT_DAILY_NOTE_FORMAT,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_MAX_TOKENS,
  DEFAULT_AI_TEMPERATURE,
  DEFAULT_MAINTENANCE_INTERVAL_MINUTES,
  DEFAULT_MAX_CONTEXT_CHUNKS,
  DEFAULT_DAILY_NOTE_SIZE_LIMIT_KB,
  DEFAULT_ARCHIVE_FOLDER,
  DEFAULT_LOCALE,
} from './constants';
import { t, setLocale, detectObsidianLocale } from './i18n';

/**
 * 기본 설정값.
 */
const DEFAULT_SETTINGS: PluginSettings = {
  aiProvider: 'openai',
  aiApiKey: '',
  aiModel: DEFAULT_AI_MODEL,
  aiMaxTokens: DEFAULT_AI_MAX_TOKENS,
  aiTemperature: DEFAULT_AI_TEMPERATURE,
  inboxFolder: DEFAULT_INBOX_FOLDER,
  autoApplyInbox: false,
  defaultSaveFolder: DEFAULT_SAVE_FOLDER,
  defaultSaveTarget: 'new-note',
  quickAskSaveMode: 'timestamp',
  dailyNoteSizeLimitKB: DEFAULT_DAILY_NOTE_SIZE_LIMIT_KB,
  maxContextChunks: DEFAULT_MAX_CONTEXT_CHUNKS,
  dailyNoteFormat: DEFAULT_DAILY_NOTE_FORMAT,
  dailyNoteFolder: DEFAULT_DAILY_NOTE_FOLDER,
  maintenanceEnabled: false,
  maintenanceIntervalMinutes: DEFAULT_MAINTENANCE_INTERVAL_MINUTES,
  maintenanceExcludeFolders: [DEFAULT_SAVE_FOLDER],
  maintenanceExcludeFiles: [],
  maintenanceExcludeTags: [],
  maintenanceArchiveFolder: DEFAULT_ARCHIVE_FOLDER,
  privacyRules: [],
  knownTags: [],
  trackTokenUsage: true,
  locale: DEFAULT_LOCALE,
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

  // Shared ConfigPort (Q1: 단일 인스턴스)
  private configPort!: ConfigPort;

  // Use Cases
  private quickAskUseCase!: QuickAskUseCase;
  private organizeNoteUseCase!: OrganizeNoteUseCase;
  private runInboxProcessUseCase!: RunInboxProcessUseCase;
  private runMaintenanceUseCase!: RunMaintenanceUseCase;
  private saveNoteUseCase!: SaveNoteUseCase;
  private captureClipboardUseCase!: CaptureClipboardUseCase;
  private getHistoryUseCase!: GetHistoryUseCase;
  private applyMaintenanceActionUseCase!: ApplyMaintenanceActionUseCase;

  // 이벤트 해제 함수
  private unsubscribeVaultEvents: (() => void) | null = null;
  private maintenanceInterval: number | null = null;

  async onload(): Promise<void> {
    console.log('Knowledge Maintenance Plugin: loading');

    // 1. 설정 로드
    await this.loadSettings();

    // 1b. 로캘 초기화
    const resolvedLocale = this.settings.locale === 'auto'
      ? detectObsidianLocale()
      : this.settings.locale;
    setLocale(resolvedLocale);

    // 2. 어댑터 초기화
    this.wireAdapters();

    // 3. 유스케이스 초기화
    this.wireUseCases();

    // 4. 뷰 등록
    this.registerViews();

    // 5. 명령 등록
    this.registerCommands();

    // 6. 설정 탭 등록
    this.addSettingTab(new PluginSettingTab(this.app, this, this.configPort));

    // 7. 폴더 우클릭 메뉴 등록
    this.registerFolderContextMenu();

    // 8. Vault 이벤트 감시 시작
    this.startInboxWatcher();

    // 9. 자동 유지보수 스케줄링
    this.scheduleMaintenanceIfEnabled();

    // 10. 앱 열림 시 Catch-up (마지막 실행 이후 변경된 Inbox 노트 처리)
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

    // ConfigPort — 단일 인스턴스로 모든 계층에 공유
    this.configPort = {
      getSettings: async () => this.settings,
      saveSettings: async (s) => { this.settings = s; await this.saveData(s); },
      updateSettings: async (partial) => {
        this.settings = { ...this.settings, ...partial };
        await this.saveData(this.settings);
      },
    };
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
    this.saveNoteUseCase = new SaveNoteUseCase(
      this.vaultAdapter, this.configPort, this.clockAdapter,
    );

    this.quickAskUseCase = new QuickAskUseCase(
      this.aiAdapter, this.vaultAdapter, this.searchIndex,
      this.historyAdapter, this.configPort, this.clockAdapter,
      this.saveNoteUseCase,
    );

    this.organizeNoteUseCase = new OrganizeNoteUseCase(
      this.aiAdapter, this.vaultAdapter,
      this.historyAdapter, this.configPort,
    );

    this.runInboxProcessUseCase = new RunInboxProcessUseCase(
      this.organizeNoteUseCase, this.vaultAdapter,
      this.configPort, this.historyAdapter, this.clockAdapter,
    );

    this.runMaintenanceUseCase = new RunMaintenanceUseCase(
      this.vaultAdapter, this.searchIndex,
      this.configPort, this.clockAdapter,
    );

    this.captureClipboardUseCase = new CaptureClipboardUseCase(
      this.clipboardAdapter, this.saveNoteUseCase,
      this.configPort, this.historyAdapter, this.clockAdapter,
    );

    this.getHistoryUseCase = new GetHistoryUseCase(this.historyAdapter);

    this.applyMaintenanceActionUseCase = new ApplyMaintenanceActionUseCase(
      this.vaultAdapter, this.historyAdapter, this.clockAdapter,
    );
  }

  private registerViews(): void {
    this.registerView(
      MAINTENANCE_LOG_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MaintenanceLogView(leaf, this.getHistoryUseCase),
    );

    this.registerView(
      MAINTENANCE_RESULT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MaintenanceResultView(
        leaf,
        this.runMaintenanceUseCase,
        this.applyMaintenanceActionUseCase,
        this.configPort,
        (path: string) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
        },
        (pathA: string, pathB: string) => {
          const fileA = this.app.vault.getAbstractFileByPath(pathA);
          const fileB = this.app.vault.getAbstractFileByPath(pathB);
          if (fileA instanceof TFile) this.app.workspace.getLeaf(false).openFile(fileA);
          if (fileB instanceof TFile) this.app.workspace.getLeaf('split').openFile(fileB);
        },
      ),
    );

    this.registerView(
      INBOX_STATUS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new InboxStatusView(leaf, this.vaultAdapter, this.configPort),
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'quick-ask',
      name: 'Quick Ask',
      callback: () => {
        let saveTarget: SaveTarget;
        if (this.settings.quickAskSaveMode === 'daily-note') {
          saveTarget = { kind: 'daily-note', position: 'bottom' };
        } else {
          const { dateFolder, title } = this.generateTimestampParts('Quick Ask');
          const folder = `${this.settings.defaultSaveFolder}/${dateFolder}`;
          saveTarget = {
            kind: 'new-note',
            title: createNoteTitle(title),
            folder: folder as unknown as NotePath,
          };
        }
        new QuickAskModal(this.app, this.quickAskUseCase, saveTarget).open();
      },
    });

    this.addCommand({
      id: 'capture-clipboard',
      name: t('command.captureClipboard'),
      callback: async () => {
        try {
          const path = await this.captureClipboardUseCase.execute();
          new Notice(t('notice.clipboardSaved', { path: String(path) }));
        } catch (err) {
          new Notice(t('notice.clipboardFailed', { error: err instanceof Error ? err.message : String(err) }));
        }
      },
    });

    this.addCommand({
      id: 'organize-current-note',
      name: t('command.organizeNote'),
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;
        if (checking) return true;

        this.organizeNoteUseCase
          .execute(createNotePath(activeFile.path), false)
          .then(result => {
            new Notice(t('notice.organizeResult', { category: result.classifiedCategory, tags: result.addedTags.join(', ') }));
          })
          .catch(err => {
            new Notice(t('notice.organizeFailed', { error: err.message }));
          });
      },
    });

    this.addCommand({
      id: 'run-maintenance',
      name: t('command.runMaintenance'),
      callback: async () => {
        await this.activateView(MAINTENANCE_RESULT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE);
        if (leaves.length > 0) {
          const view = leaves[0].view as MaintenanceResultView;
          await view.triggerScan();
        }
      },
    });

    this.addCommand({
      id: 'run-inbox-process',
      name: t('command.runInbox'),
      callback: async () => {
        new Notice(t('notice.inboxStarted'));
        try {
          const result = await this.runInboxProcessUseCase.execute();
          new Notice(t('notice.inboxComplete', {
            processed: result.processedCount,
            skipped: result.skippedCount,
            errors: result.errors.length,
          }));
        } catch (err) {
          new Notice(t('notice.inboxFailed', { error: err instanceof Error ? err.message : String(err) }));
        }
      },
    });

    this.addCommand({
      id: 'open-maintenance-log',
      name: t('command.openLog'),
      callback: () => this.activateView(MAINTENANCE_LOG_VIEW_TYPE),
    });

    this.addCommand({
      id: 'open-inbox-status',
      name: t('command.openInbox'),
      callback: () => this.activateView(INBOX_STATUS_VIEW_TYPE),
    });
  }

  private registerFolderContextMenu(): void {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem(item => {
          item
            .setTitle(t('command.scanFolder'))
            .setIcon('shield-check')
            .onClick(async () => {
              await this.activateView(MAINTENANCE_RESULT_VIEW_TYPE);
              const leaves = this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE);
              if (leaves.length > 0) {
                const view = leaves[0].view as MaintenanceResultView;
                view.triggerScanForFolder(file.path);
              }
            });
        });
      }),
    );
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingPaths = new Set<string>();

    this.unsubscribeVaultEvents = this.vaultAdapter.watchEvents((event: VaultEvent) => {
      if (event.type !== 'create' && event.type !== 'modify') return;

      const pathStr = event.path as string;
      if (!pathStr.startsWith(this.settings.inboxFolder)) return;

      pendingPaths.add(pathStr);

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const count = pendingPaths.size;
        pendingPaths.clear();

        new Notice(t('notice.inboxDetected', { count }));
      }, INBOX_DEBOUNCE_MS);
    });
  }

  private scheduleMaintenanceIfEnabled(): void {
    if (!this.settings.maintenanceEnabled) return;

    const ms = this.settings.maintenanceIntervalMinutes * 60 * 1000;
    this.maintenanceInterval = window.setInterval(async () => {
      try {
        await this.runMaintenanceUseCase.execute();
      } catch (err) {
        console.error('Knowledge Maintenance: scheduled maintenance failed', err);
      }
    }, ms);
    this.registerInterval(this.maintenanceInterval);
  }

  private generateTimestampParts(prefix: string): { dateFolder: string; title: string } {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return {
      dateFolder: `${y}-${mo}-${d}`,
      title: `${prefix} ${h}${mi}${s}`,
    };
  }

  private async runCatchUp(): Promise<void> {
    if (!this.settings.autoApplyInbox) return;

    try {
      await this.runInboxProcessUseCase.execute();
    } catch (err) {
      console.error('Knowledge Maintenance: catch-up 실패', err);
    }
  }
}
