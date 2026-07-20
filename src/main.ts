import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { PluginSettings } from './application/ports/ConfigPort';

// Adapters
import { ObsidianVaultAdapter } from './adapters/vault/ObsidianVaultAdapter';
import { DynamicAIAdapter } from './adapters/ai/DynamicAIAdapter';
import { JsonSearchIndexAdapter } from './adapters/search/JsonSearchIndexAdapter';
import { FileHistoryAdapter } from './adapters/history/FileHistoryAdapter';

import { SystemClockAdapter } from './adapters/clock/SystemClockAdapter';
import { FileChangeTrackingAdapter } from './adapters/tracking/FileChangeTrackingAdapter';
import { FileCorpusStatsAdapter } from './adapters/corpus/FileCorpusStatsAdapter';
import { LinkSuggestionService } from './domain/services/LinkSuggestionService';
import { TfIdfCorpus } from './domain/services/TfIdfCorpus';
import { tokenizeForTfIdf } from './domain/services/tokenize';
import { AIEmbeddingAdapter } from './adapters/embedding/AIEmbeddingAdapter';
import { JsonVectorStoreAdapter } from './adapters/vectorstore/JsonVectorStoreAdapter';

// Use Cases
import { OrganizeNoteUseCase } from './application/usecases/OrganizeNoteUseCase';
import { OrganizeFolderUseCase } from './application/usecases/RunInboxProcessUseCase';
import { RunMaintenanceUseCase } from './application/usecases/RunMaintenanceUseCase';
import { SaveNoteUseCase } from './application/usecases/SaveNoteUseCase';

import { GetHistoryUseCase } from './application/usecases/GetHistoryUseCase';
import { ApplyMaintenanceActionUseCase } from './application/usecases/ApplyMaintenanceActionUseCase';
import { SyncEmbeddingsUseCase } from './application/usecases/SyncEmbeddingsUseCase';
import { GenerateOrganizeVaultUseCase } from './application/usecases/GenerateOrganizeVaultUseCase';
import { ApplyOrganizeVaultUseCase } from './application/usecases/ApplyOrganizeVaultUseCase';
import { RollbackOrganizeVaultUseCase } from './application/usecases/RollbackOrganizeVaultUseCase';
import { EstimateRefactorCostUseCase } from './application/usecases/EstimateRefactorCostUseCase';
import { GenerateRefactorPlanUseCase } from './application/usecases/GenerateRefactorPlanUseCase';
import { RecordPreferenceUseCase } from './application/usecases/RecordPreferenceUseCase';

// UI
import { OrganizeResultModal, OrganizeApplyActions } from './ui/OrganizeResultModal';
import { MaintenanceLogView, MAINTENANCE_LOG_VIEW_TYPE } from './ui/MaintenanceLogView';
import { MaintenanceResultView, MAINTENANCE_RESULT_VIEW_TYPE } from './ui/MaintenanceResultView';
import { OrganizeFolderResultView, ORGANIZE_FOLDER_VIEW_TYPE } from './ui/OrganizeFolderResultView';
import { FolderSuggestModal } from './ui/FolderSuggestModal';
import { OrganizeVaultView, ORGANIZE_VAULT_VIEW_TYPE } from './ui/OrganizeVaultView';
import { FileOrganizeVaultAdapter } from './adapters/organize-vault/FileOrganizeVaultAdapter';
import { FilePreferenceAdapter } from './adapters/preference/FilePreferenceAdapter';
import { FileTagEmbeddingCacheAdapter } from './adapters/tag-embedding-cache/FileTagEmbeddingCacheAdapter';
import { FileNoteEmbeddingCacheAdapter } from './adapters/note-embedding-cache/FileNoteEmbeddingCacheAdapter';
import { NoteEmbeddingService } from './domain/services/NoteEmbeddingService';
import { PluginSettingTab } from './ui/PluginSettingTab';
import { localizeError } from './ui/localizeError';

// Pro (tree-shaken in free builds via ENABLE_PRO=false)
import { LocalLicenseAdapter } from './adapters/license/LocalLicenseAdapter';

// Ports
import { AIProviderPort } from './application/ports/AIProviderPort';
import { ConfigPort } from './application/ports/ConfigPort';
import { VaultEvent } from './application/ports/VaultAccessPort';
import { NotePath, createNotePath } from './domain/values/NotePath';
import type { MaintenancePlan, DuplicatePair } from './domain/models/OrganizeModels';
import { timestampNow } from './domain/values/Timestamp';
import {
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
  COMMAND_VAULT_REFACTOR,
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
  ollamaBaseUrl: 'http://localhost:11434',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  customBaseUrl: '',
  customApiKey: '',
  customModel: '',
  captureFolder: 'Inbox',
  autoApplyOrganize: false,
  defaultSaveFolder: DEFAULT_SAVE_FOLDER,
  defaultSaveTarget: 'new-note',
  dailyNoteSizeLimitKB: DEFAULT_DAILY_NOTE_SIZE_LIMIT_KB,
  maxContextChunks: DEFAULT_MAX_CONTEXT_CHUNKS,
  dailyNoteFormat: DEFAULT_DAILY_NOTE_FORMAT,
  dailyNoteFolder: DEFAULT_DAILY_NOTE_FOLDER,
  maintenanceEnabled: false,
  maintenanceIntervalMinutes: DEFAULT_MAINTENANCE_INTERVAL_MINUTES,
  smartScheduling: true,
  maintenanceExcludeFolders: [DEFAULT_SAVE_FOLDER],
  maintenanceExcludeFiles: [],
  maintenanceExcludeTags: [],
  maintenanceArchiveFolder: DEFAULT_ARCHIVE_FOLDER,
  rejectDecayDays: 7,
  organizeConfidenceThreshold: 0,
  embeddingsEnabled: false,
  embeddingsModel: '',
  linkSimilarityThreshold: 0.55,
  rrfEmbeddingWeight: 4.0,
  rrfK: 20,
  privacyRules: [],
  knownTags: [],
  trackTokenUsage: true,
  locale: DEFAULT_LOCALE,
  licenseKey: '',
  proGraceDeadline: 0,
};

export default class KnowledgeMaintenancePlugin extends Plugin {
  declare settings: PluginSettings;

  // Adapters
  private vaultAdapter!: ObsidianVaultAdapter;
  private aiAdapter!: AIProviderPort;
  private searchIndex!: JsonSearchIndexAdapter;
  private historyAdapter!: FileHistoryAdapter;

  private clockAdapter!: SystemClockAdapter;
  private changeTracker!: FileChangeTrackingAdapter;
  private corpusStatsAdapter!: FileCorpusStatsAdapter;
  private embeddingAdapter!: AIEmbeddingAdapter;
  private vectorStoreAdapter!: JsonVectorStoreAdapter;
  private organizeVaultAdapter!: FileOrganizeVaultAdapter;
  private preferenceAdapter!: FilePreferenceAdapter;
  private tagEmbeddingCacheAdapter!: FileTagEmbeddingCacheAdapter;
  private noteEmbeddingCacheAdapter!: FileNoteEmbeddingCacheAdapter;

  // Shared ConfigPort (single instance)
  private configPort!: ConfigPort;

  // Use Cases
  private organizeNoteUseCase!: OrganizeNoteUseCase;
  private organizeFolderUseCase!: OrganizeFolderUseCase;
  private runMaintenanceUseCase!: RunMaintenanceUseCase;
  private saveNoteUseCase!: SaveNoteUseCase;

  private getHistoryUseCase!: GetHistoryUseCase;
  private applyMaintenanceActionUseCase!: ApplyMaintenanceActionUseCase;
  private syncEmbeddingsUseCase!: SyncEmbeddingsUseCase;
  private generateOrganizeVaultUseCase!: GenerateOrganizeVaultUseCase;
  private applyOrganizeVaultUseCase!: ApplyOrganizeVaultUseCase;
  private rollbackOrganizeVaultUseCase!: RollbackOrganizeVaultUseCase;
  private estimateRefactorCostUseCase!: EstimateRefactorCostUseCase;
  private generateRefactorPlanUseCase!: GenerateRefactorPlanUseCase;
  private recordPreferenceUseCase!: RecordPreferenceUseCase;

  // Pro (beta only — tree-shaken in free builds)
  private licenseAdapter: import('./application/ports/LicensePort').LicensePort | null = null;

  // Event unsubscribe functions
  private unsubscribeVaultEvents: (() => void) | null = null;
  private maintenanceInterval: number | null = null;
  private isMaintenanceRunning = false;
  private isOrganizing = false;
  private embeddingInitGeneration = 0;

  async onload(): Promise<void> {

    // 1. Load settings
    await this.loadSettings();

    // 1b. Initialize locale
    const resolvedLocale = this.settings.locale === 'auto'
      ? detectObsidianLocale()
      : this.settings.locale;
    setLocale(resolvedLocale);

    // 2. Initialize adapters
    this.wireAdapters();

    // 2b. Pro features (beta builds only — dead-code-eliminated in free builds)
    if (ENABLE_PRO) {
      this.wireProFeatures();
    }

    // 3. Initialize use cases
    this.wireUseCases();

    // 4. Register views
    this.registerViews();

    // 5. Register commands
    this.registerCommands();

    // 6. Register settings tab
    this.addSettingTab(new PluginSettingTab(this.app, this, this.configPort, () => {
      this.scheduleMaintenanceIfEnabled();
    }, this.preferenceAdapter, async () => {
      const gen = ++this.embeddingInitGeneration;
      try {
        await this.reinitializeEmbeddings(gen);
        if (gen !== this.embeddingInitGeneration) return;
        if (this.embeddingAdapter.isReady()) {
          this.syncEmbeddingsBackground();
        }
      } catch (err) {
        console.error('Vaultend: AI config change re-initialization failed', err);
      }
    }));

    // 7. Register folder context menu
    this.registerFolderContextMenu();

    // 8. Start vault event watching
    this.startVaultWatcher();

    // 9. Schedule auto-maintenance
    this.scheduleMaintenanceIfEnabled();

    // 10. Initialize search index + embeddings on layout ready
    this.app.workspace.onLayoutReady(async () => {
      await this.buildSearchIndex();

      await this.vectorStoreAdapter.load();
      await this.tagEmbeddingCacheAdapter.load();
      await this.noteEmbeddingCacheAdapter.load();

      if (this.hasAIProviderConfig()) {
        await this.reinitializeEmbeddings();

        if (this.embeddingAdapter.isReady()) {
          this.syncEmbeddingsBackground();
        }
      }
    });
  }

  onunload(): void {

    // Persist dirty set before shutdown
    this.changeTracker.persist();

    // Unsubscribe event watchers
    if (this.unsubscribeVaultEvents) {
      this.unsubscribeVaultEvents();
      this.unsubscribeVaultEvents = null;
    }

    // Flush embedding caches
    this.tagEmbeddingCacheAdapter.flush().catch(() => {});
    this.noteEmbeddingCacheAdapter.flush().catch(() => {});

    // Clear maintenance timer
    if (this.maintenanceInterval !== null) {
      window.clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
  }

  // ─── Internal methods ───

  private hasAIProviderConfig(): boolean {
    const s = this.settings;
    switch (s.aiProvider) {
      case 'ollama': return !!s.ollamaBaseUrl;
      case 'deepseek': return !!(s.deepseekApiKey || s.aiApiKey);
      case 'custom': return !!s.customBaseUrl;
      default: return !!s.aiApiKey;
    }
  }

  private getEmbeddingModelId(): string {
    const s = this.settings;
    if (s.embeddingsModel) return s.embeddingsModel;
    switch (s.aiProvider) {
      case 'gemini': return 'gemini-embedding-001';
      case 'ollama': return 'nomic-embed-text';
      case 'deepseek': return 'default';
      case 'custom': return s.customModel || 'default';
      default: return 'text-embedding-3-small';
    }
  }

  private async reinitializeEmbeddings(generation?: number): Promise<void> {
    const provider = this.settings.aiProvider;
    const model = this.getEmbeddingModelId();

    const vsMeta = this.vectorStoreAdapter.getMeta();
    const tcMeta = this.tagEmbeddingCacheAdapter.getMeta();
    const cachedMeta = (vsMeta && vsMeta.provider === provider && vsMeta.model === model) ? vsMeta
      : (tcMeta && tcMeta.provider === provider && tcMeta.model === model) ? tcMeta
      : null;
    if (cachedMeta && cachedMeta.dimension > 0) {
      this.embeddingAdapter.initializeWithKnownDimension(cachedMeta.dimension);
    } else {
      await this.embeddingAdapter.initialize();
    }

    if (!this.embeddingAdapter.isReady()) return;
    if (generation !== undefined && generation !== this.embeddingInitGeneration) return;

    const dim = this.embeddingAdapter.getDimension();

    if (!this.vectorStoreAdapter.isEmpty() && !this.vectorStoreAdapter.isCompatible(provider, dim, model)) {
      await this.vectorStoreAdapter.clear();
    }
    this.vectorStoreAdapter.setMeta({ provider, dimension: dim, model });

    if (this.tagEmbeddingCacheAdapter.size() > 0
      && !this.tagEmbeddingCacheAdapter.isCompatible(provider, dim, model)) {
      await this.tagEmbeddingCacheAdapter.clear();
    }
    this.tagEmbeddingCacheAdapter.setMeta({ provider, dimension: dim, model });

    const { titleWeight, bodyWeight } = NoteEmbeddingService.DEFAULT_CONFIG;
    if (this.noteEmbeddingCacheAdapter.size() > 0
      && !this.noteEmbeddingCacheAdapter.isCompatible(provider, dim, titleWeight, bodyWeight, model)) {
      await this.noteEmbeddingCacheAdapter.clear();
    }
    this.noteEmbeddingCacheAdapter.setMeta({ provider, dimension: dim, titleWeight, bodyWeight, model });
  }

  private async loadSettings(): Promise<void> {
    const data = await this.loadData();
    const raw = data ?? {};

    // Migrate legacy setting names
    if ('inboxFolder' in raw && !('captureFolder' in raw)) {
      raw.captureFolder = raw.inboxFolder;
      delete raw.inboxFolder;
    }
    if ('autoApplyInbox' in raw && !('autoApplyOrganize' in raw)) {
      raw.autoApplyOrganize = raw.autoApplyInbox;
      delete raw.autoApplyInbox;
    }
    if ('inboxConfidenceThreshold' in raw && !('organizeConfidenceThreshold' in raw)) {
      raw.organizeConfidenceThreshold = raw.inboxConfidenceThreshold;
      delete raw.inboxConfidenceThreshold;
    }

    this.settings = { ...DEFAULT_SETTINGS, ...raw };
  }

  private wireAdapters(): void {
    this.vaultAdapter = new ObsidianVaultAdapter(this.app);
    this.clockAdapter = new SystemClockAdapter();
    this.searchIndex = new JsonSearchIndexAdapter(this.vaultAdapter);
    this.historyAdapter = new FileHistoryAdapter(this.vaultAdapter, this.clockAdapter);

    this.changeTracker = new FileChangeTrackingAdapter(this.vaultAdapter);
    this.corpusStatsAdapter = new FileCorpusStatsAdapter(this.vaultAdapter);
    this.vectorStoreAdapter = new JsonVectorStoreAdapter(this.vaultAdapter);

    // ConfigPort — shared single instance across all layers
    this.configPort = {
      getSettings: async () => this.settings,
      saveSettings: async (s) => { this.settings = s; await this.saveData(s); },
      updateSettings: async (partial) => {
        this.settings = { ...this.settings, ...partial };
        await this.saveData(this.settings);
      },
    };

    // AI adapter — reads latest settings from ConfigPort on each call, delegates to the appropriate provider
    this.aiAdapter = new DynamicAIAdapter(this.configPort);
    this.embeddingAdapter = new AIEmbeddingAdapter(this.aiAdapter);

    // Organize Vault adapter — file-based storage for OrganizeVault plans
    this.organizeVaultAdapter = new FileOrganizeVaultAdapter(this.vaultAdapter);

    if (ENABLE_PRO) {
      this.preferenceAdapter = new FilePreferenceAdapter(this.vaultAdapter, this.configPort);
    }
    this.tagEmbeddingCacheAdapter = new FileTagEmbeddingCacheAdapter(this.vaultAdapter);
    this.noteEmbeddingCacheAdapter = new FileNoteEmbeddingCacheAdapter(this.vaultAdapter);
  }

  private wireProFeatures(): void {
    this.licenseAdapter = new LocalLicenseAdapter(this.configPort);
  }

  private wireUseCases(): void {
    this.saveNoteUseCase = new SaveNoteUseCase(
      this.vaultAdapter, this.configPort, this.clockAdapter,
    );

    this.organizeNoteUseCase = new OrganizeNoteUseCase(
      this.aiAdapter, this.vaultAdapter,
      this.historyAdapter, this.configPort,
      this.tagEmbeddingCacheAdapter,
      this.noteEmbeddingCacheAdapter,
    );

    this.organizeFolderUseCase = new OrganizeFolderUseCase(
      this.organizeNoteUseCase, this.vaultAdapter,
      this.configPort, this.historyAdapter, this.clockAdapter,
      this.aiAdapter,
      this.tagEmbeddingCacheAdapter,
      this.noteEmbeddingCacheAdapter,
    );

    this.runMaintenanceUseCase = new RunMaintenanceUseCase(
      this.vaultAdapter, this.searchIndex,
      this.configPort, this.clockAdapter,
      this.changeTracker, this.corpusStatsAdapter,
      this.aiAdapter,
      this.tagEmbeddingCacheAdapter,
    );


    this.getHistoryUseCase = new GetHistoryUseCase(this.historyAdapter);

    this.applyMaintenanceActionUseCase = new ApplyMaintenanceActionUseCase(
      this.vaultAdapter, this.historyAdapter, this.clockAdapter,
    );

    this.syncEmbeddingsUseCase = new SyncEmbeddingsUseCase(
      this.embeddingAdapter, this.vectorStoreAdapter,
      this.vaultAdapter, this.changeTracker,
    );

    if (ENABLE_PRO) {
      this.generateOrganizeVaultUseCase = new GenerateOrganizeVaultUseCase(
        this.clockAdapter, this.vaultAdapter,
        this.searchIndex, this.organizeVaultAdapter,
        this.aiAdapter, this.configPort,
        this.preferenceAdapter,
      );

      this.applyOrganizeVaultUseCase = new ApplyOrganizeVaultUseCase(
        this.vaultAdapter, this.historyAdapter,
        this.clockAdapter, this.organizeVaultAdapter, this.configPort,
      );

      this.rollbackOrganizeVaultUseCase = new RollbackOrganizeVaultUseCase(
        this.historyAdapter, this.clockAdapter, this.organizeVaultAdapter,
      );

      this.estimateRefactorCostUseCase = new EstimateRefactorCostUseCase(this.configPort);

      this.recordPreferenceUseCase = new RecordPreferenceUseCase(
        this.preferenceAdapter, this.clockAdapter,
      );

      this.generateRefactorPlanUseCase = new GenerateRefactorPlanUseCase(
        this.clockAdapter, this.vaultAdapter,
        this.searchIndex, this.organizeVaultAdapter,
        this.aiAdapter, this.configPort,
        this.preferenceAdapter,
      );
    }
  }

  private registerViews(): void {
    this.registerView(
      MAINTENANCE_LOG_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MaintenanceLogView(leaf, this.getHistoryUseCase, this.historyAdapter),
    );

    this.registerView(
      MAINTENANCE_RESULT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MaintenanceResultView(
        leaf,
        this.runMaintenanceUseCase,
        this.applyMaintenanceActionUseCase,
        this.configPort,
        this.historyAdapter,
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
        (pair) => this.triggerMergeForPair(pair),
        (notePath) => this.findLinksForOrphan(notePath),
      ),
    );

    this.registerView(
      ORGANIZE_FOLDER_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new OrganizeFolderResultView(
        leaf,
        this.organizeFolderUseCase,
        this.buildOrganizeApplyActions(),
        this.configPort,
        this.historyAdapter,
        this.vaultAdapter,
        (path: string) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
        },
        (v: boolean) => { this.isOrganizing = v; },
      ),
    );

    if (ENABLE_PRO) {
      this.registerView(
        ORGANIZE_VAULT_VIEW_TYPE,
        (leaf: WorkspaceLeaf) => new OrganizeVaultView(
          leaf,
          this.runMaintenanceUseCase,
          this.generateOrganizeVaultUseCase,
          this.applyOrganizeVaultUseCase,
          this.rollbackOrganizeVaultUseCase,
          this.organizeVaultAdapter,
          (path: string) => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
          },
          this.vaultAdapter,
          this.estimateRefactorCostUseCase,
          this.generateRefactorPlanUseCase,
          this.recordPreferenceUseCase,
        ),
      );
    }
  }


  private registerCommands(): void {
    this.addCommand({
      id: 'organize-current-note',
      name: t('command.organizeNote'),
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;
        if (checking) return true;

        const notePath = createNotePath(activeFile.path);
        new Notice(t('organize.analyzing'));

        this.organizeNoteUseCase
          .execute(notePath, false)
          .then(async result => {
            const actions = this.buildOrganizeApplyActions();
            new OrganizeResultModal(this.app, notePath, result, actions).open();
          })
          .catch(err => {
            new Notice(t('notice.organizeFailed', { error: localizeError(err) }));
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
      id: 'organize-folder',
      name: t('command.organizeFolder'),
      callback: async () => {
        if (this.isOrganizing) {
          new Notice(t('notice.organizeAlreadyRunning'));
          return;
        }
        new FolderSuggestModal(this.app, async (folder) => {
          await this.activateView(ORGANIZE_FOLDER_VIEW_TYPE);
          const leaves = this.app.workspace.getLeavesOfType(ORGANIZE_FOLDER_VIEW_TYPE);
          if (leaves.length > 0) {
            const view = leaves[0].view as OrganizeFolderResultView;
            view.triggerScan(folder.path);
          }
        }).open();
      },
    });

    this.addCommand({
      id: 'open-maintenance-log',
      name: t('command.openLog'),
      callback: () => this.activateView(MAINTENANCE_LOG_VIEW_TYPE),
    });

    if (ENABLE_PRO) {
      this.addCommand({
        id: COMMAND_VAULT_REFACTOR,
        name: t('command.vaultRefactor'),
        callback: async () => {
          await this.activateView(ORGANIZE_VAULT_VIEW_TYPE);
          const leaves = this.app.workspace.getLeavesOfType(ORGANIZE_VAULT_VIEW_TYPE);
          if (leaves.length > 0) {
            const view = leaves[0].view as OrganizeVaultView;
            view.openRefactorModal();
          }
        },
      });
    }

  }

  private buildOrganizeApplyActions(): OrganizeApplyActions {
    return {
      applyTags: async (path, tags) => {
        const note = await this.vaultAdapter.readNote(path);
        if (!note) return;
        const existing = note.metadata.tags.map(tag => tag as string);
        const newTags = tags.filter(tag => !existing.includes(tag));
        if (newTags.length > 0) {
          await this.vaultAdapter.updateFrontmatter(path, {
            tags: [...existing, ...newTags],
          });
        }
      },
      addLinks: async (path, links) => {
        const note = await this.vaultAdapter.readNote(path);
        if (!note) return;
        const linkLines = links.map(link => {
          const linkPath = (link as string).replace('.md', '');
          return `- [[${linkPath}]]`;
        });
        const section = `\n\n## Related Notes\n\n${linkLines.join('\n')}`;
        await this.vaultAdapter.writeNote(path, note.content + section);
      },
    };
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
                await view.triggerScanForFolder(file.path);
              }
            });
        });
        menu.addItem(item => {
          item
            .setTitle(t('command.organizeFolder'))
            .setIcon('wand')
            .onClick(async () => {
              if (this.isOrganizing) {
                new Notice(t('notice.organizeAlreadyRunning'));
                return;
              }
              await this.activateView(ORGANIZE_FOLDER_VIEW_TYPE);
              const leaves = this.app.workspace.getLeavesOfType(ORGANIZE_FOLDER_VIEW_TYPE);
              if (leaves.length > 0) {
                const view = leaves[0].view as OrganizeFolderResultView;
                view.triggerScan(file.path);
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

  private startVaultWatcher(): void {
    this.unsubscribeVaultEvents = this.vaultAdapter.watchEvents((event: VaultEvent) => {
      const pathStr = event.path as string;

      // Track all .md file changes for smart scheduling
      if (pathStr.endsWith('.md')) {
        this.changeTracker.markDirty(event.path);

        // Incremental search index update (BM25 + embeddings)
        if (event.type === 'delete') {
          this.searchIndex.remove(event.path);
          this.vectorStoreAdapter.remove(event.path).catch(() => {});
        } else if (event.type === 'rename') {
          if (event.oldPath) {
            this.searchIndex.remove(event.oldPath);
            this.vectorStoreAdapter.remove(event.oldPath).catch(() => {});
          }
          this.indexSingleNote(event.path);
          this.syncEmbeddingsUseCase.syncSingle(event.path).catch(() => {});
        } else if (event.type === 'create' || event.type === 'modify') {
          this.indexSingleNote(event.path);
          this.syncEmbeddingsUseCase.syncSingle(event.path).catch(() => {});
        }
      }
    });
  }

  private async scheduleMaintenanceIfEnabled(): Promise<void> {
    if (!ENABLE_PRO) return;
    if (this.maintenanceInterval !== null) {
      window.clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }

    if (!this.settings.maintenanceEnabled) return;

    const ms = this.settings.maintenanceIntervalMinutes * 60 * 1000;
    let firstRun = true;
    this.maintenanceInterval = window.setInterval(async () => {
      if (this.isMaintenanceRunning) return;
      const leaves = this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE);
      if (leaves.length > 0) {
        const view = leaves[0].view as MaintenanceResultView;
        if (view.isScanInProgress()) return;
      }
      this.isMaintenanceRunning = true;
      try {
        if (this.settings.smartScheduling && !firstRun) {
          const lastScan = await this.changeTracker.getLastScanTimestamp();
          if (lastScan !== null) {
            const dirtySet = await this.changeTracker.getDirtySet();
            if (dirtySet.size === 0) return;
          }
        }
        firstRun = false;
        const plan = await this.runMaintenanceUseCase.execute();
        this.showMaintenancePlanIfNeeded(plan);
      } catch (err) {
        console.error('Vaultend: scheduled maintenance failed', err);
      } finally {
        this.isMaintenanceRunning = false;
      }
    }, ms);
    this.registerInterval(this.maintenanceInterval);
  }

  private async showMaintenancePlanIfNeeded(plan: MaintenancePlan): Promise<void> {
    const totalIssues = plan.orphanNotes.length
      + plan.duplicateCandidates.length
      + plan.brokenLinks.length
      + plan.missingTags.length
      + plan.emptyNotes.length
      + plan.untaggedNotes.length
      + plan.duplicateTags.length;
    if (totalIssues === 0) return;

    await this.activateView(MAINTENANCE_RESULT_VIEW_TYPE);
    const leaves = this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE);
    if (leaves.length > 0) {
      const view = leaves[0].view as MaintenanceResultView;
      if (view.isScanInProgress()) return;
      view.showPlan(plan);
    }
    new Notice(t('notice.autoMaintenanceFound', { count: totalIssues }));
  }

  private async findLinksForOrphan(notePath: NotePath): Promise<ReadonlyArray<NotePath>> {
    const note = await this.vaultAdapter.readNote(notePath);
    if (!note) return [];

    const allNotes = await this.vaultAdapter.listNotes();
    const orphanTokens = tokenizeForTfIdf(note.content);
    const orphanTags = note.metadata.tags.map(t => t as string);

    const corpus = new TfIdfCorpus();
    const savedStats = await this.corpusStatsAdapter.loadStats();
    if (savedStats) corpus.loadFromStats(savedStats);

    corpus.addDocument(notePath as string, orphanTokens);

    const candidates: Array<{ path: string; tags: string[]; tokens: string[] }> = [];
    for (const np of allNotes) {
      if (np === notePath) continue;
      const candidateNote = await this.vaultAdapter.readNote(np);
      if (!candidateNote) continue;
      const tokens = tokenizeForTfIdf(candidateNote.content);
      corpus.addDocument(np as string, tokens);
      candidates.push({
        path: np as string,
        tags: candidateNote.metadata.tags.map(t => t as string),
        tokens,
      });
    }

    const suggestions = LinkSuggestionService.findRelatedNotes({
      orphanPath: notePath as string,
      orphanTags,
      orphanTokens,
      candidates,
      corpus,
    });

    return suggestions.map(s => createNotePath(s.path));
  }

  private async triggerMergeForPair(pair: DuplicatePair): Promise<void> {
    if (!ENABLE_PRO) return;
    const minPlan: MaintenancePlan = {
      orphanNotes: [],
      duplicateCandidates: [pair],
      brokenLinks: [],
      missingTags: [],
      emptyNotes: [],
      duplicateTags: [],
      untaggedNotes: [],
      timestamp: timestampNow(),
    };
    try {
      const organizeVaultPlan = await this.generateOrganizeVaultUseCase.execute(minPlan);
      if (organizeVaultPlan.proposals.length === 0) {
        new Notice(t('organizeVault.empty'));
        return;
      }
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: ORGANIZE_VAULT_VIEW_TYPE, active: true });
      const view = leaf.view as OrganizeVaultView;
      view.showPlan(organizeVaultPlan);
    } catch (err) {
      new Notice(t('organizeVault.scanFailed', { error: String(err) }));
    }
  }

  private async syncEmbeddingsBackground(): Promise<void> {
    try {
      if (this.vectorStoreAdapter.isEmpty()) {
        await this.syncEmbeddingsUseCase.rebuildAll();
      } else {
        await this.syncEmbeddingsUseCase.execute();
      }
    } catch {
      // Embedding sync is best-effort
    }
  }

  private async buildSearchIndex(): Promise<void> {
    try {
      await this.searchIndex.rebuild();
      const notes = await this.vaultAdapter.listNotes();
      const saveFolder = this.settings.defaultSaveFolder;
      let indexed = 0;
      for (const notePath of notes) {
        const pathStr = notePath as string;
        if (saveFolder.length > 0 && (pathStr === saveFolder || pathStr.startsWith(saveFolder + '/'))) continue;
        const note = await this.vaultAdapter.readNote(notePath);
        if (note && note.chunks.length > 0) {
          await this.searchIndex.index(notePath, note.chunks);
          indexed++;
        }
      }
    } catch (err) {
      console.error('Vaultend: search index build failed', err);
    }
  }

  private async indexSingleNote(notePath: NotePath): Promise<void> {
    try {
      const pathStr = notePath as string;
      const sf = this.settings.defaultSaveFolder;
      if (sf.length > 0 && (pathStr === sf || pathStr.startsWith(sf + '/'))) return;
      const note = await this.vaultAdapter.readNote(notePath);
      if (note && note.chunks.length > 0) {
        await this.searchIndex.index(notePath, note.chunks);
      } else {
        await this.searchIndex.remove(notePath);
      }
    } catch {
      // Non-critical — index will be rebuilt next startup
    }
  }
}
