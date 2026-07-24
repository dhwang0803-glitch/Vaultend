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
import { BuildSummaryIndexUseCase } from './application/usecases/BuildSummaryIndexUseCase';
import { OrganizeTagsUseCase } from './application/usecases/OrganizeTagsUseCase';
import { replaceRelatedNotesSection } from './application/utils/relatedNotesSection';

// UI
import { OrganizeResultModal, type OrganizeApplyActions } from './ui/OrganizeResultModal';
import type { BatchOrganizeCallbacks } from './ui/OrganizeBatchPreviewModal';
import { MaintenanceLogView, MAINTENANCE_LOG_VIEW_TYPE } from './ui/MaintenanceLogView';
import { MaintenanceResultView, MAINTENANCE_RESULT_VIEW_TYPE } from './ui/MaintenanceResultView';
import { OrganizeFolderResultView, ORGANIZE_FOLDER_VIEW_TYPE } from './ui/OrganizeFolderResultView';
import { FolderSuggestModal } from './ui/FolderSuggestModal';
import { OrganizeTagsView, ORGANIZE_TAGS_VIEW_TYPE } from './ui/OrganizeTagsView';
import { FileTagEmbeddingCacheAdapter } from './adapters/tag-embedding-cache/FileTagEmbeddingCacheAdapter';
import { FileTagGroupCacheAdapter } from './adapters/tag-group-cache/FileTagGroupCacheAdapter';
import { FileNoteEmbeddingCacheAdapter } from './adapters/note-embedding-cache/FileNoteEmbeddingCacheAdapter';
import { InMemoryOrganizeResultCacheAdapter } from './adapters/organize-result-cache/InMemoryOrganizeResultCacheAdapter';
import { NoteEmbeddingService } from './domain/services/NoteEmbeddingService';
import { PluginSettingTab } from './ui/PluginSettingTab';
import { localizeError } from './ui/localizeError';

// Ports
import { AIProviderPort } from './application/ports/AIProviderPort';
import { ConfigPort } from './application/ports/ConfigPort';
import { VaultEvent } from './application/ports/VaultAccessPort';
import { NotePath, createNotePath } from './domain/values/NotePath';
import type { MaintenancePlan, OrganizeResult } from './domain/models/OrganizeModels';
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
  COMMAND_ORGANIZE_TAGS,
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
  linkSimilarityThreshold: 0.40,
  rrfEmbeddingWeight: 4.0,
  rrfK: 20,
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

  private clockAdapter!: SystemClockAdapter;
  private changeTracker!: FileChangeTrackingAdapter;
  private corpusStatsAdapter!: FileCorpusStatsAdapter;
  private embeddingAdapter!: AIEmbeddingAdapter;
  private vectorStoreAdapter!: JsonVectorStoreAdapter;
  private tagEmbeddingCacheAdapter!: FileTagEmbeddingCacheAdapter;
  private noteEmbeddingCacheAdapter!: FileNoteEmbeddingCacheAdapter;
  private tagGroupCacheAdapter!: FileTagGroupCacheAdapter;
  private organizeResultCache!: InMemoryOrganizeResultCacheAdapter;

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
  private organizeTagsUseCase!: OrganizeTagsUseCase;

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

    // 3. Initialize use cases
    this.wireUseCases();

    // 4. Register views
    this.registerViews();

    // 5. Register commands
    this.registerCommands();

    // 6. Register settings tab
    this.addSettingTab(new PluginSettingTab(this.app, this, this.configPort, () => {
      void this.scheduleMaintenanceIfEnabled();
    }, () => {
      void (async () => {
        const gen = ++this.embeddingInitGeneration;
        try {
          await this.reinitializeEmbeddings(gen);
          if (gen !== this.embeddingInitGeneration) return;
          if (this.embeddingAdapter.isReady()) {
            void this.syncEmbeddingsBackground();
          }
        } catch (err) {
          console.error('Vaultend: AI config change re-initialization failed', err);
          new Notice(t('notice.embeddingInitFailed', { error: localizeError(err) }));
        }
      })();
    }));

    // 7. Register folder context menu
    this.registerFolderContextMenu();

    // 8. Start vault event watching
    this.startVaultWatcher();

    // 9. Schedule auto-maintenance
    void this.scheduleMaintenanceIfEnabled();

    // 10. Initialize search index + embeddings on layout ready
    this.app.workspace.onLayoutReady(async () => {
      await this.buildSearchIndex();

      await this.vectorStoreAdapter.load();
      await this.tagEmbeddingCacheAdapter.load();
      await this.noteEmbeddingCacheAdapter.load();
      await this.tagGroupCacheAdapter.load();

      if (this.hasAIProviderConfig()) {
        await this.reinitializeEmbeddings();

        if (this.embeddingAdapter.isReady()) {
          void this.syncEmbeddingsBackground();
        }
      }
    });
  }

  onunload(): void {

    // Persist dirty set before shutdown
    this.changeTracker.persist().catch(() => {});

    // Unsubscribe event watchers
    if (this.unsubscribeVaultEvents) {
      this.unsubscribeVaultEvents();
      this.unsubscribeVaultEvents = null;
    }

    // Flush embedding caches
    this.tagEmbeddingCacheAdapter.flush().catch(() => {});
    this.noteEmbeddingCacheAdapter.flush().catch(() => {});
    this.tagGroupCacheAdapter.flush().catch(() => {});

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
      case 'custom': return !!s.customBaseUrl;
      default: return !!s.aiApiKey;
    }
  }

  private getEmbeddingModelId(): string {
    const s = this.settings;
    if (s.embeddingsModel) return s.embeddingsModel;
    const defaults: Record<string, string> = {
      openai: 'text-embedding-3-small',
      gemini: 'gemini-embedding-001',
      ollama: 'nomic-embed-text',
      custom: s.customModel || 'default',
    };
    return defaults[s.aiProvider] ?? 'text-embedding-3-small';
  }

  private async reinitializeEmbeddings(generation?: number): Promise<void> {
    const provider = this.settings.aiProvider;
    const model = this.getEmbeddingModelId();
    this.embeddingAdapter.setModel(model);

    const vsMeta = this.vectorStoreAdapter.getMeta();
    const tcMeta = this.tagEmbeddingCacheAdapter.getMeta();
    const cachedMeta = (vsMeta && vsMeta.provider === provider && vsMeta.model === model) ? vsMeta
      : (tcMeta && tcMeta.provider === provider && tcMeta.model === model) ? tcMeta
      : null;
    if (cachedMeta && cachedMeta.dimension > 0) {
      this.embeddingAdapter.initializeWithKnownDimension(cachedMeta.dimension);
    } else {
      try {
        const ok = await this.embeddingAdapter.initialize();
        if (!ok) {
          new Notice(t('notice.embeddingInitFailed', { error: `${provider} / ${model}` }));
        }
      } catch (err) {
        new Notice(t('notice.embeddingInitFailed', { error: localizeError(err) }));
        return;
      }
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
    const data: Record<string, unknown> = (await this.loadData() as Record<string, unknown> | null) ?? {};

    // Migrate legacy setting names
    if ('inboxFolder' in data && !('captureFolder' in data)) {
      data.captureFolder = data.inboxFolder;
      delete data.inboxFolder;
    }
    if ('autoApplyInbox' in data && !('autoApplyOrganize' in data)) {
      data.autoApplyOrganize = data.autoApplyInbox;
      delete data.autoApplyInbox;
    }
    if ('inboxConfidenceThreshold' in data && !('organizeConfidenceThreshold' in data)) {
      data.organizeConfidenceThreshold = data.inboxConfidenceThreshold;
      delete data.inboxConfidenceThreshold;
    }

    this.settings = { ...DEFAULT_SETTINGS, ...data };
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

    this.tagEmbeddingCacheAdapter = new FileTagEmbeddingCacheAdapter(this.vaultAdapter);
    this.noteEmbeddingCacheAdapter = new FileNoteEmbeddingCacheAdapter(this.vaultAdapter);
    this.tagGroupCacheAdapter = new FileTagGroupCacheAdapter(this.vaultAdapter);
    this.organizeResultCache = new InMemoryOrganizeResultCacheAdapter();
  }

  private wireUseCases(): void {
    this.saveNoteUseCase = new SaveNoteUseCase(
      this.vaultAdapter, this.configPort, this.clockAdapter,
    );

    const buildSummaryIndex = this.hasAIProviderConfig()
      ? new BuildSummaryIndexUseCase(
        this.vaultAdapter, this.aiAdapter,
        this.noteEmbeddingCacheAdapter, this.configPort,
      )
      : undefined;

    this.organizeNoteUseCase = new OrganizeNoteUseCase(
      this.aiAdapter, this.vaultAdapter,
      this.historyAdapter, this.configPort,
      this.tagEmbeddingCacheAdapter,
      this.noteEmbeddingCacheAdapter,
      buildSummaryIndex,
      this.organizeResultCache,
    );

    this.organizeFolderUseCase = new OrganizeFolderUseCase(
      this.organizeNoteUseCase, this.vaultAdapter,
      this.configPort, this.historyAdapter, this.clockAdapter,
      this.aiAdapter,
      this.tagEmbeddingCacheAdapter,
      this.noteEmbeddingCacheAdapter,
      buildSummaryIndex,
    );

    this.runMaintenanceUseCase = new RunMaintenanceUseCase(
      this.vaultAdapter, this.searchIndex,
      this.configPort, this.clockAdapter,
      this.changeTracker, this.corpusStatsAdapter,
      this.aiAdapter,
      this.tagEmbeddingCacheAdapter,
      this.noteEmbeddingCacheAdapter,
      buildSummaryIndex,
    );


    this.getHistoryUseCase = new GetHistoryUseCase(this.historyAdapter);

    this.applyMaintenanceActionUseCase = new ApplyMaintenanceActionUseCase(
      this.vaultAdapter, this.historyAdapter, this.clockAdapter,
    );

    this.organizeTagsUseCase = new OrganizeTagsUseCase(
      this.vaultAdapter,
      this.hasAIProviderConfig() ? this.aiAdapter : undefined,
      this.tagGroupCacheAdapter,
      this.configPort,
    );

    this.syncEmbeddingsUseCase = new SyncEmbeddingsUseCase(
      this.embeddingAdapter, this.vectorStoreAdapter,
      this.vaultAdapter, this.changeTracker,
    );

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
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        },
        (pathA: string, pathB: string) => {
          const fileA = this.app.vault.getAbstractFileByPath(pathA);
          const fileB = this.app.vault.getAbstractFileByPath(pathB);
          if (fileA instanceof TFile) void this.app.workspace.getLeaf(false).openFile(fileA);
          if (fileB instanceof TFile) void this.app.workspace.getLeaf('split').openFile(fileB);
        },
        () => {},
        (notePaths, onProgress) => this.previewOrganizeNotes(notePaths, onProgress),
        (notePaths, onProgress) => this.previewOrganizeNotesTagsOnly(notePaths, onProgress),
        this.buildBatchOrganizeCallbacks(),
        () => this.organizeResultCache.clear(),
        async (path) => this.organizeNoteUseCase.execute(path, false, { forceRefresh: true }),
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
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        },
        (v: boolean) => { this.isOrganizing = v; },
      ),
    );

    this.registerView(
      ORGANIZE_TAGS_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new OrganizeTagsView(
        leaf,
        this.organizeTagsUseCase,
        this.applyMaintenanceActionUseCase,
        this.historyAdapter,
        (path: string) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        },
      ),
    );

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
            new OrganizeResultModal(
              this.app, notePath, result, actions,
              this.historyAdapter, this.vaultAdapter,
              async (path) => this.organizeNoteUseCase.execute(path, false, { forceRefresh: true }),
            ).open();
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
        new FolderSuggestModal(this.app, (folder) => {
          void (async () => {
            try {
              await this.activateView(ORGANIZE_FOLDER_VIEW_TYPE);
              const leaves = this.app.workspace.getLeavesOfType(ORGANIZE_FOLDER_VIEW_TYPE);
              if (leaves.length > 0) {
                const view = leaves[0].view as OrganizeFolderResultView;
                void view.triggerScan(folder.path);
              }
            } catch (err) {
              console.error('Vaultend: failed to open organize folder view', err);
            }
          })();
        }).open();
      },
    });

    this.addCommand({
      id: 'open-maintenance-log',
      name: t('command.openLog'),
      callback: () => { void this.activateView(MAINTENANCE_LOG_VIEW_TYPE); },
    });

    this.addCommand({
      id: COMMAND_ORGANIZE_TAGS,
      name: t('command.organizeTags'),
      callback: async () => {
        await this.activateView(ORGANIZE_TAGS_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(ORGANIZE_TAGS_VIEW_TYPE);
        if (leaves.length > 0) {
          const view = leaves[0].view as OrganizeTagsView;
          await view.triggerScan();
        }
      },
    });

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
        const linkStrs = links.map(l => l as string);
        await this.vaultAdapter.writeNote(path, replaceRelatedNotesSection(note.content, linkStrs));
      },
    };
  }

  private buildBatchOrganizeCallbacks(): BatchOrganizeCallbacks {
    return {
      actions: this.buildOrganizeApplyActions(),
      readContent: async (path) => {
        const note = await this.vaultAdapter.readNote(path);
        return note?.content ?? '';
      },
      writeContent: async (path, content) => {
        await this.vaultAdapter.writeNote(path, content);
      },
      recordHistory: async (id, notePath, previousContent, description, tags, links) => {
        await this.historyAdapter.record({
          id,
          action: 'classify',
          notePath,
          timestamp: timestampNow(),
          description,
          previousContent,
          metadata: { tags, links },
        });
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
                void view.triggerScan(file.path);
              }
            });
        });
      }),
    );
  }

  private async activateView(viewType: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
      void this.app.workspace.revealLeaf(leaf);
    }
  }

  private startVaultWatcher(): void {
    this.unsubscribeVaultEvents = this.vaultAdapter.watchEvents((event: VaultEvent) => {
      const pathStr = event.path as string;

      // Track all .md file changes for smart scheduling
      if (pathStr.endsWith('.md')) {
        void this.changeTracker.markDirty(event.path);

        // Incremental search index update (BM25 + embeddings)
        if (event.type === 'delete') {
          this.searchIndex.remove(event.path).catch(() => {});
          this.vectorStoreAdapter.remove(event.path).catch(() => {});
        } else if (event.type === 'rename') {
          if (event.oldPath) {
            this.searchIndex.remove(event.oldPath).catch(() => {});
            this.vectorStoreAdapter.remove(event.oldPath).catch(() => {});
          }
          void this.indexSingleNote(event.path);
          this.syncEmbeddingsUseCase.syncSingle(event.path).catch(() => {});
        } else if (event.type === 'create' || event.type === 'modify') {
          void this.indexSingleNote(event.path);
          this.syncEmbeddingsUseCase.syncSingle(event.path).catch(() => {});
        }
      }
    });
  }

  private async scheduleMaintenanceIfEnabled(): Promise<void> {
    if (this.maintenanceInterval !== null) {
      window.clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }

    if (!this.settings.maintenanceEnabled) return;

    const ms = this.settings.maintenanceIntervalMinutes * 60 * 1000;
    let firstRun = true;
    this.maintenanceInterval = window.setInterval(() => {
      void (async () => {
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
          void this.showMaintenancePlanIfNeeded(plan);
        } catch (err) {
          console.error('Vaultend: scheduled maintenance failed', err);
          new Notice(t('notice.maintenanceFailed', { error: localizeError(err) }));
        } finally {
          this.isMaintenanceRunning = false;
        }
      })();
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

  private async previewOrganizeNotes(notePaths: NotePath[], onProgress?: (current: number, total: number) => void): Promise<Array<{ notePath: NotePath; result: OrganizeResult }>> {
    const results: Array<{ notePath: NotePath; result: OrganizeResult }> = [];
    let failed = 0;
    for (let i = 0; i < notePaths.length; i++) {
      try {
        const result = await this.organizeNoteUseCase.execute(notePaths[i], false);
        results.push({ notePath: notePaths[i], result });
      } catch {
        failed++;
      }
      onProgress?.(i + 1, notePaths.length);
    }
    if (failed > 0) {
      new Notice(t('notice.organizePreviewFailed', { failed }));
    }
    return results;
  }

  private async previewOrganizeNotesTagsOnly(notePaths: NotePath[], onProgress?: (current: number, total: number) => void): Promise<Array<{ notePath: NotePath; result: OrganizeResult }>> {
    const results: Array<{ notePath: NotePath; result: OrganizeResult }> = [];
    let failed = 0;
    for (let i = 0; i < notePaths.length; i++) {
      try {
        const result = await this.organizeNoteUseCase.execute(notePaths[i], false, { skipLinkSuggestion: true });
        results.push({ notePath: notePaths[i], result });
      } catch {
        failed++;
      }
      onProgress?.(i + 1, notePaths.length);
    }
    if (failed > 0) {
      new Notice(t('notice.organizePreviewFailed', { failed }));
    }
    return results;
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
      for (const notePath of notes) {
        const pathStr = notePath as string;
        if (saveFolder.length > 0 && (pathStr === saveFolder || pathStr.startsWith(saveFolder + '/'))) continue;
        const note = await this.vaultAdapter.readNote(notePath);
        if (note && note.chunks.length > 0) {
          await this.searchIndex.index(notePath, note.chunks);
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
