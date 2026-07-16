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
import { QuickAskUseCase } from './application/usecases/QuickAskUseCase';
import { OrganizeNoteUseCase } from './application/usecases/OrganizeNoteUseCase';
import { OrganizeFolderUseCase } from './application/usecases/RunInboxProcessUseCase';
import { RunMaintenanceUseCase } from './application/usecases/RunMaintenanceUseCase';
import { SaveNoteUseCase } from './application/usecases/SaveNoteUseCase';

import { GetHistoryUseCase } from './application/usecases/GetHistoryUseCase';
import { ApplyMaintenanceActionUseCase } from './application/usecases/ApplyMaintenanceActionUseCase';
import { SyncEmbeddingsUseCase } from './application/usecases/SyncEmbeddingsUseCase';

// UI
import { QuickAskModal } from './ui/QuickAskModal';
import { OrganizeResultModal, OrganizeApplyActions, OrganizeModalContext } from './ui/OrganizeResultModal';
import { MaintenanceLogView, MAINTENANCE_LOG_VIEW_TYPE } from './ui/MaintenanceLogView';
import { MaintenanceResultView, MAINTENANCE_RESULT_VIEW_TYPE } from './ui/MaintenanceResultView';
import { OrganizeFolderResultView, ORGANIZE_FOLDER_VIEW_TYPE } from './ui/OrganizeFolderResultView';
import { FolderSuggestModal } from './ui/FolderSuggestModal';
import { PluginSettingTab } from './ui/PluginSettingTab';
import { localizeError } from './ui/localizeError';

// Ports
import { AIProviderPort } from './application/ports/AIProviderPort';
import { ConfigPort } from './application/ports/ConfigPort';
import { VaultEvent } from './application/ports/VaultAccessPort';
import { NotePath, createNotePath } from './domain/values/NotePath';
import type { MaintenancePlan } from './domain/models/OrganizeModels';
import { SaveTarget } from './domain/models/SaveTarget';
import { createNoteTitle } from './domain/values/NoteTitle';
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
  captureFolder: 'Inbox',
  autoApplyOrganize: false,
  defaultSaveFolder: DEFAULT_SAVE_FOLDER,
  defaultSaveTarget: 'new-note',
  quickAskSaveMode: 'timestamp',
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
  organizeConfidenceThreshold: 0,
  embeddingsEnabled: false,
  embeddingsModel: '',
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

  // Shared ConfigPort (single instance)
  private configPort!: ConfigPort;

  // Use Cases
  private quickAskUseCase!: QuickAskUseCase;
  private organizeNoteUseCase!: OrganizeNoteUseCase;
  private organizeFolderUseCase!: OrganizeFolderUseCase;
  private runMaintenanceUseCase!: RunMaintenanceUseCase;
  private saveNoteUseCase!: SaveNoteUseCase;

  private getHistoryUseCase!: GetHistoryUseCase;
  private applyMaintenanceActionUseCase!: ApplyMaintenanceActionUseCase;
  private syncEmbeddingsUseCase!: SyncEmbeddingsUseCase;

  // Event unsubscribe functions
  private unsubscribeVaultEvents: (() => void) | null = null;
  private maintenanceInterval: number | null = null;
  private isMaintenanceRunning = false;
  private isOrganizing = false;

  async onload(): Promise<void> {
    console.log('Vaultend Plugin: loading');

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
      this.scheduleMaintenanceIfEnabled();
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

      if (this.settings.aiApiKey) {
        await this.vectorStoreAdapter.load();
        await this.embeddingAdapter.initialize();

        if (this.embeddingAdapter.isReady()) {
          const dim = this.embeddingAdapter.getDimension();
          const provider = this.settings.aiProvider;

          if (!this.vectorStoreAdapter.isEmpty() && !this.vectorStoreAdapter.isCompatible(provider, dim)) {
            console.log('Vaultend: embedding provider/dimension changed, rebuilding index');
            await this.vectorStoreAdapter.clear();
          }
          this.vectorStoreAdapter.setMeta({ provider, dimension: dim });
          this.syncEmbeddingsBackground();
        }
      }
    });
  }

  onunload(): void {
    console.log('Vaultend Plugin: unloading');

    // Persist dirty set before shutdown
    this.changeTracker.persist();

    // Unsubscribe event watchers
    if (this.unsubscribeVaultEvents) {
      this.unsubscribeVaultEvents();
      this.unsubscribeVaultEvents = null;
    }

    // Clear maintenance timer
    if (this.maintenanceInterval !== null) {
      window.clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
  }

  // ─── Internal methods ───

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
    this.embeddingAdapter = new AIEmbeddingAdapter(this.aiAdapter, this.configPort);
  }

  private wireUseCases(): void {
    this.saveNoteUseCase = new SaveNoteUseCase(
      this.vaultAdapter, this.configPort, this.clockAdapter,
    );

    this.quickAskUseCase = new QuickAskUseCase(
      this.aiAdapter, this.vaultAdapter, this.searchIndex,
      this.historyAdapter, this.configPort, this.clockAdapter,
      this.saveNoteUseCase,
      this.embeddingAdapter,
      this.vectorStoreAdapter,
    );

    this.organizeNoteUseCase = new OrganizeNoteUseCase(
      this.aiAdapter, this.vaultAdapter,
      this.historyAdapter, this.configPort,
    );

    this.organizeFolderUseCase = new OrganizeFolderUseCase(
      this.organizeNoteUseCase, this.vaultAdapter,
      this.configPort, this.historyAdapter, this.clockAdapter,
      this.aiAdapter,
    );

    this.runMaintenanceUseCase = new RunMaintenanceUseCase(
      this.vaultAdapter, this.searchIndex,
      this.configPort, this.clockAdapter,
      this.changeTracker, this.corpusStatsAdapter,
      this.aiAdapter,
    );


    this.getHistoryUseCase = new GetHistoryUseCase(this.historyAdapter);

    this.applyMaintenanceActionUseCase = new ApplyMaintenanceActionUseCase(
      this.vaultAdapter, this.historyAdapter, this.clockAdapter,
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
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'quick-ask',
      name: 'Quick Ask',
      callback: () => {
        const createSaveTarget = (): SaveTarget => {
          if (this.settings.quickAskSaveMode === 'daily-note') {
            return { kind: 'daily-note', position: 'bottom' };
          }
          const { dateFolder, title } = this.generateTimestampParts('Quick Ask');
          const folder = `${this.settings.defaultSaveFolder}/${dateFolder}`;
          return {
            kind: 'new-note',
            title: createNoteTitle(title),
            folder: folder as unknown as NotePath,
          };
        };
        new QuickAskModal(this.app, this.quickAskUseCase, createSaveTarget).open();
      },
    });


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
            const allNotes = await this.vaultAdapter.listNotes();
            const folderSet = new Set<string>();
            for (const np of allNotes) {
              const pathStr = np as string;
              const slash = pathStr.lastIndexOf('/');
              if (slash > 0) folderSet.add(pathStr.substring(0, slash));
            }
            const ctx: OrganizeModalContext = {
              existingFolders: [...folderSet].sort(),
            };
            new OrganizeResultModal(this.app, notePath, result, actions, ctx).open();
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
      moveNote: async (path, targetFolder) => {
        const filename = (path as string).split('/').pop() ?? '';
        const newPath = createNotePath(`${targetFolder}/${filename}`);
        const existing = await this.vaultAdapter.readNote(newPath);
        if (existing) {
          throw new Error(`Note already exists: ${newPath as string}`);
        }
        await this.vaultAdapter.moveNote(path, newPath);
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
                view.triggerScanForFolder(file.path);
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

  private scheduleMaintenanceIfEnabled(): void {
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
        if (view.isRestoreInProgress()) return;
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

  private showMaintenancePlanIfNeeded(plan: MaintenancePlan): void {
    const totalIssues = plan.orphanNotes.length
      + plan.duplicateCandidates.length
      + plan.brokenLinks.length
      + plan.missingTags.length
      + plan.emptyNotes.length
      + plan.untaggedNotes.length;
    if (totalIssues === 0) return;

    const leaves = this.app.workspace.getLeavesOfType(MAINTENANCE_RESULT_VIEW_TYPE);
    if (leaves.length > 0) {
      const view = leaves[0].view as MaintenanceResultView;
      if (view.isScanInProgress()) return;
      if (view.isRestoreInProgress()) return;
      view.showPlan(plan);
    }
    new Notice(t('notice.autoMaintenanceFound', { count: totalIssues }));
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

  private async syncEmbeddingsBackground(): Promise<void> {
    try {
      if (this.vectorStoreAdapter.isEmpty()) {
        const count = await this.syncEmbeddingsUseCase.rebuildAll();
        console.log(`Vaultend: embedding index built (${count} notes)`);
      } else {
        const result = await this.syncEmbeddingsUseCase.execute();
        if (result.indexed > 0) {
          console.log(`Vaultend: embedding sync (${result.indexed} indexed, ${result.skipped} skipped)`);
        }
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
      console.log(`Vaultend: search index built (${indexed}/${notes.length} notes indexed)`);
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
