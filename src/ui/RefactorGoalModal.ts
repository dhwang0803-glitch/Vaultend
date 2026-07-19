import { Modal, App, Setting, Notice } from 'obsidian';
import type { EstimateRefactorCostUseCase } from '../application/usecases/EstimateRefactorCostUseCase';
import type { GenerateRefactorPlanUseCase } from '../application/usecases/GenerateRefactorPlanUseCase';
import type { VaultAccessPort } from '../application/ports/VaultAccessPort';
import type {
  RefactorGoalType,
  RefactorGoal,
  RefactorCostEstimate,
  VaultMetadataSnapshot,
  RefactorProgress,
} from '../domain/models/RefactorModels';
import type { OrganizeVaultPlan } from '../domain/models/OrganizeVaultPlan';
import { FLEETING_WORD_COUNT_THRESHOLD } from '../constants';
import { t } from '../i18n';

interface RefactorGoalOption {
  readonly type: RefactorGoalType;
  readonly titleKey: string;
  readonly descKey: string;
}

const GOAL_OPTIONS: ReadonlyArray<RefactorGoalOption> = [
  { type: 'detect-misplaced', titleKey: 'refactor.mode.misplaced', descKey: 'refactor.mode.misplacedDesc' },
  { type: 'optimize-folders', titleKey: 'refactor.mode.folders', descKey: 'refactor.mode.foldersDesc' },
  { type: 'promote-fleeting', titleKey: 'refactor.mode.promote', descKey: 'refactor.mode.promoteDesc' },
  { type: 'reorganize-notes', titleKey: 'refactor.mode.reorganize', descKey: 'refactor.mode.reorganizeDesc' },
  { type: 'clean-up-tags', titleKey: 'refactor.mode.tags', descKey: 'refactor.mode.tagsDesc' },
  { type: 'suggest-links', titleKey: 'refactor.mode.links', descKey: 'refactor.mode.linksDesc' },
  { type: 'consolidate-fleeting', titleKey: 'refactor.mode.fleeting', descKey: 'refactor.mode.fleetingDesc' },
];

export class RefactorGoalModal extends Modal {
  private selectedType: RefactorGoalType = 'detect-misplaced';
  private fleetingThreshold = FLEETING_WORD_COUNT_THRESHOLD;
  private affinityThreshold = 0.3;
  private bloatedThreshold = 30;
  private thinThreshold = 3;
  private fleetingFolders = 'Inbox, Fleeting';
  private maturityAgeDays = 7;
  private maturityWordCount = 100;
  private estimate: RefactorCostEstimate | null = null;
  private snapshot: VaultMetadataSnapshot | null = null;
  private abortController: AbortController | null = null;
  private isRunning = false;

  constructor(
    app: App,
    private readonly vault: VaultAccessPort,
    private readonly estimateCost: EstimateRefactorCostUseCase,
    private readonly generatePlan: GenerateRefactorPlanUseCase,
    private readonly onComplete: (plan: OrganizeVaultPlan) => void,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('vaultend-refactor-modal');

    contentEl.createEl('h2', { text: t('refactor.title' as any) });

    await this.loadSnapshot();
    this.renderGoalSelection(contentEl);
  }

  onClose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.contentEl.empty();
  }

  private async loadSnapshot(): Promise<void> {
    const [noteEntries, tagFrequencies] = await Promise.all([
      this.vault.listNotesWithMetadata(),
      this.vault.listAllTags(),
    ]);


    const folderSet = new Set<string>();
    for (const entry of noteEntries) {
      if (entry.folder) folderSet.add(entry.folder);
    }

    this.snapshot = {
      noteEntries: [...noteEntries],
      folderTree: [...folderSet].sort(),
      tagFrequencies: [...tagFrequencies],
      totalNotes: noteEntries.length,
    };

    this.updateEstimate();
  }

  private renderGoalSelection(container: HTMLElement): void {
    const radioGroup = container.createDiv({ cls: 'vaultend-refactor-goals' });

    for (const option of GOAL_OPTIONS) {
      const row = radioGroup.createDiv({ cls: 'vaultend-refactor-goal-row' });
      const label = row.createEl('label', { cls: 'vaultend-refactor-goal-label' });

      const radio = label.createEl('input', { type: 'radio' }) as HTMLInputElement;
      radio.name = 'refactor-goal';
      radio.value = option.type;
      radio.checked = option.type === this.selectedType;
      radio.addEventListener('change', () => {
        this.selectedType = option.type;
        this.updateEstimate();
        this.renderParams(paramsContainer);
        this.renderEstimate(estimateContainer);
      });

      label.createSpan({ text: t(option.titleKey as any), cls: 'vaultend-refactor-goal-title' });
      row.createEl('p', { text: t(option.descKey as any), cls: 'vaultend-refactor-goal-desc' });
    }

    const paramsContainer = container.createDiv({ cls: 'vaultend-refactor-params' });
    this.renderParams(paramsContainer);

    const estimateContainer = container.createDiv({ cls: 'vaultend-refactor-estimate' });
    this.renderEstimate(estimateContainer);

    const progressContainer = container.createDiv({ cls: 'vaultend-refactor-progress' });
    progressContainer.style.display = 'none';

    const actionBar = container.createDiv({ cls: 'vaultend-refactor-actions' });
    new Setting(actionBar)
      .addButton(btn => btn
        .setButtonText(t('refactor.start' as any))
        .setCta()
        .onClick(() => this.startRefactor(progressContainer, actionBar)))
      .addButton(btn => btn
        .setButtonText(t('btn.close'))
        .onClick(() => this.close()));
  }

  private renderParams(container: HTMLElement): void {
    container.empty();

    if (this.selectedType === 'consolidate-fleeting') {
      new Setting(container)
        .setName(t('refactor.fleetingThreshold' as any))
        .setDesc(t('refactor.fleetingThresholdDesc' as any))
        .addSlider(slider => slider
          .setLimits(50, 500, 10)
          .setValue(this.fleetingThreshold)
          .setDynamicTooltip()
          .onChange(val => {
            this.fleetingThreshold = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
    } else if (this.selectedType === 'detect-misplaced') {
      new Setting(container)
        .setName(t('refactor.affinityThreshold' as any))
        .setDesc(t('refactor.affinityThresholdDesc' as any))
        .addSlider(slider => slider
          .setLimits(0.1, 0.6, 0.05)
          .setValue(this.affinityThreshold)
          .setDynamicTooltip()
          .onChange(val => {
            this.affinityThreshold = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
    } else if (this.selectedType === 'optimize-folders') {
      new Setting(container)
        .setName(t('refactor.bloatedThreshold' as any))
        .setDesc(t('refactor.bloatedThresholdDesc' as any))
        .addSlider(slider => slider
          .setLimits(10, 100, 5)
          .setValue(this.bloatedThreshold)
          .setDynamicTooltip()
          .onChange(val => {
            this.bloatedThreshold = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
      new Setting(container)
        .setName(t('refactor.thinThreshold' as any))
        .setDesc(t('refactor.thinThresholdDesc' as any))
        .addSlider(slider => slider
          .setLimits(1, 10, 1)
          .setValue(this.thinThreshold)
          .setDynamicTooltip()
          .onChange(val => {
            this.thinThreshold = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
    } else if (this.selectedType === 'promote-fleeting') {
      new Setting(container)
        .setName(t('refactor.fleetingFolders' as any))
        .setDesc(t('refactor.fleetingFoldersDesc' as any))
        .addText(text => text
          .setValue(this.fleetingFolders)
          .onChange(val => {
            this.fleetingFolders = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
      new Setting(container)
        .setName(t('refactor.maturityAge' as any))
        .setDesc(t('refactor.maturityAgeDesc' as any))
        .addSlider(slider => slider
          .setLimits(1, 60, 1)
          .setValue(this.maturityAgeDays)
          .setDynamicTooltip()
          .onChange(val => {
            this.maturityAgeDays = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
      new Setting(container)
        .setName(t('refactor.maturityWordCount' as any))
        .setDesc(t('refactor.maturityWordCountDesc' as any))
        .addSlider(slider => slider
          .setLimits(50, 500, 10)
          .setValue(this.maturityWordCount)
          .setDynamicTooltip()
          .onChange(val => {
            this.maturityWordCount = val;
            this.updateEstimate();
            this.renderEstimate(this.contentEl.querySelector('.vaultend-refactor-estimate') as HTMLElement);
          }));
    }
  }

  private renderEstimate(container: HTMLElement): void {
    container.empty();
    if (!this.estimate) {
      container.createEl('p', { text: t('refactor.calculating' as any) });
      return;
    }

    const e = this.estimate;
    container.createEl('h4', { text: t('refactor.costEstimate' as any) });

    const table = container.createEl('div', { cls: 'vaultend-refactor-estimate-table' });
    const addRow = (label: string, value: string) => {
      const row = table.createDiv({ cls: 'vaultend-refactor-estimate-row' });
      row.createSpan({ text: label, cls: 'vaultend-refactor-estimate-label' });
      row.createSpan({ text: value, cls: 'vaultend-refactor-estimate-value' });
    };

    addRow(t('refactor.estNotes' as any), String(e.noteCount));
    if (e.tagCount !== undefined) addRow(t('refactor.estTags' as any), String(e.tagCount));
    addRow(t('refactor.estAICalls' as any), `~${e.estimatedAICalls}`);
    addRow(t('refactor.estCost' as any), `~$${e.estimatedCostUsd.toFixed(3)}`);
    addRow(t('refactor.estDuration' as any), this.formatDuration(e.estimatedDurationSeconds));
  }

  private updateEstimate(): void {
    if (!this.snapshot) return;
    const goal = this.buildGoal();
    this.estimate = this.estimateCost.execute(goal, this.snapshot);
  }

  private buildGoal(): RefactorGoal {
    return {
      goalType: this.selectedType,
      parameters: {
        fleetingWordCountThreshold: this.selectedType === 'consolidate-fleeting'
          ? this.fleetingThreshold
          : undefined,
        misplacedAffinityThreshold: this.selectedType === 'detect-misplaced'
          ? this.affinityThreshold
          : undefined,
        bloatedFolderThreshold: this.selectedType === 'optimize-folders'
          ? this.bloatedThreshold
          : undefined,
        thinFolderThreshold: this.selectedType === 'optimize-folders'
          ? this.thinThreshold
          : undefined,
        fleetingFolders: this.selectedType === 'promote-fleeting'
          ? this.fleetingFolders.split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
        maturityAgeDays: this.selectedType === 'promote-fleeting'
          ? this.maturityAgeDays
          : undefined,
        maturityMinWordCount: this.selectedType === 'promote-fleeting'
          ? this.maturityWordCount
          : undefined,
      },
    };
  }

  private async startRefactor(
    progressContainer: HTMLElement,
    actionBar: HTMLElement,
  ): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    actionBar.style.display = 'none';
    progressContainer.style.display = 'block';
    progressContainer.empty();

    const phaseLabel = progressContainer.createEl('p', { cls: 'vaultend-refactor-phase' });
    const progressBar = progressContainer.createEl('progress', { cls: 'vaultend-refactor-bar' }) as HTMLProgressElement;
    progressBar.max = 100;
    progressBar.value = 0;

    const cancelBtn = progressContainer.createEl('button', {
      text: t('organizeFolder.cancel'),
      cls: 'vaultend-refactor-cancel',
    });

    this.abortController = new AbortController();
    cancelBtn.addEventListener('click', () => {
      this.abortController?.abort();
    });

    const goal = this.buildGoal();

    try {
      const plan = await this.generatePlan.execute(
        goal,
        this.abortController.signal,
        (p: RefactorProgress) => {
          phaseLabel.setText(`${this.phaseLabel(p.phase)}: ${p.message}`);
          if (p.totalSteps > 0) {
            progressBar.value = Math.round((p.currentStep / p.totalSteps) * 100);
          }
        },
      );

      new Notice(t('refactor.complete' as any, { count: String(plan.proposals.length) }));
      this.onComplete(plan);
      this.close();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        new Notice(t('refactor.cancelled' as any));
      } else {
        new Notice(t('organizeVault.scanFailed', { error: err instanceof Error ? err.message : String(err) }));
      }
      progressContainer.style.display = 'none';
      actionBar.style.display = '';
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  private phaseLabel(phase: string): string {
    const labels: Record<string, string> = {
      collecting: t('refactor.phaseCollecting' as any),
      analyzing: t('refactor.phaseAnalyzing' as any),
      synthesizing: t('refactor.phaseSynthesizing' as any),
      converting: t('refactor.phaseConverting' as any),
    };
    return labels[phase] ?? phase;
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `~${seconds}s`;
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec > 0 ? `~${min}m ${sec}s` : `~${min}m`;
  }
}
