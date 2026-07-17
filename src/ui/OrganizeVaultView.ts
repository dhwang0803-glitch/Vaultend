import { ItemView, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { RunMaintenanceUseCase } from '../application/usecases/RunMaintenanceUseCase';
import { GenerateOrganizeVaultUseCase } from '../application/usecases/GenerateOrganizeVaultUseCase';
import { ApplyOrganizeVaultUseCase } from '../application/usecases/ApplyOrganizeVaultUseCase';
import { RollbackOrganizeVaultUseCase } from '../application/usecases/RollbackOrganizeVaultUseCase';
import type { OrganizeVaultPort } from '../application/ports/OrganizeVaultPort';
import {
  OrganizeVaultPlan,
  OrganizeVaultProposal,
  ConfidenceLevel,
  countByType,
  getApprovedProposals,
} from '../domain/models/OrganizeVaultPlan';
import { localizeError } from './localizeError';
import { ORGANIZE_VAULT_VIEW_TYPE } from '../constants';
import { t } from '../i18n';

export { ORGANIZE_VAULT_VIEW_TYPE };

const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: 'var(--text-success)',
  medium: 'var(--text-warning)',
  low: 'var(--text-faint)',
};

const CONFIDENCE_ICONS: Record<ConfidenceLevel, string> = {
  high: '🟢',
  medium: '🟡',
  low: '⚪',
};

export class OrganizeVaultView extends ItemView {
  private currentPlan: OrganizeVaultPlan | null = null;
  private scanInProgress = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly runMaintenance: RunMaintenanceUseCase,
    private readonly generatePlan: GenerateOrganizeVaultUseCase,
    private readonly applyPlan: ApplyOrganizeVaultUseCase,
    private readonly rollbackPlan: RollbackOrganizeVaultUseCase,
    private readonly store: OrganizeVaultPort,
    private readonly openFile: (path: string) => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return ORGANIZE_VAULT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('organizeVault.viewTitle');
  }

  getIcon(): string {
    return 'shield-check';
  }

  async onOpen(): Promise<void> {
    this.renderEmpty();
  }

  isScanInProgress(): boolean {
    return this.scanInProgress;
  }

  async triggerScan(folderPath?: string): Promise<void> {
    if (this.scanInProgress) return;
    this.scanInProgress = true;

    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.createEl('div', {
      text: t('organizeVault.scanning'),
      cls: 'vaultend-organize-vault-scanning',
    });

    try {
      const options = folderPath ? { folder: folderPath } : undefined;
      const maintenancePlan = await this.runMaintenance.execute(options);
      const plan = await this.generatePlan.execute(maintenancePlan);
      this.currentPlan = plan;
      this.render();
    } catch (err) {
      container.empty();
      container.createEl('div', {
        text: t('organizeVault.scanFailed', { error: localizeError(err) }),
        cls: 'vaultend-organize-vault-error',
      });
    } finally {
      this.scanInProgress = false;
    }
  }

  showPlan(plan: OrganizeVaultPlan): void {
    this.currentPlan = plan;
    this.render();
  }

  private renderEmpty(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('vaultend-organize-vault-container');

    const emptyDiv = container.createDiv({ cls: 'vaultend-organize-vault-empty' });
    emptyDiv.createEl('h3', { text: t('organizeVault.title') });
    emptyDiv.createEl('p', { text: t('organizeVault.generateScanDesc') });

    new Setting(emptyDiv)
      .addButton(btn => btn
        .setButtonText(t('organizeVault.generateScan'))
        .setCta()
        .onClick(() => this.triggerScan()));
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('vaultend-organize-vault-container');

    if (!this.currentPlan || this.currentPlan.proposals.length === 0) {
      container.createEl('div', {
        text: t('organizeVault.empty'),
        cls: 'vaultend-organize-vault-empty',
      });
      new Setting(container)
        .addButton(btn => btn
          .setButtonText(t('organizeVault.rescan'))
          .onClick(() => this.triggerScan()));
      return;
    }

    this.renderHeader(container);
    this.renderProposals(container);
    this.renderActions(container);
  }

  private renderHeader(container: HTMLElement): void {
    const plan = this.currentPlan!;
    const header = container.createDiv({ cls: 'vaultend-organize-vault-header' });

    const titleRow = header.createDiv({ cls: 'vaultend-organize-vault-title-row' });
    titleRow.createEl('h3', { text: t('organizeVault.title') });

    const statusBadge = titleRow.createSpan({ cls: 'vaultend-organize-vault-status-badge' });
    statusBadge.setText(t(`organizeVault.status.${plan.status}` as any));
    statusBadge.addClass(`vaultend-organize-vault-status-${plan.status}`);

    const summary = header.createDiv({ cls: 'vaultend-organize-vault-summary' });
    summary.createEl('span', {
      text: t('organizeVault.summary', { count: String(plan.proposals.length) }),
    });

    const counts = countByType(plan.proposals);
    const typeSummary = header.createDiv({ cls: 'vaultend-organize-vault-type-summary' });
    typeSummary.createEl('span', {
      text: t('organizeVault.summaryByType', {
        reposition: String(counts['reposition'] ?? 0),
        links: String(counts['fix-broken-link'] ?? 0),
        tags: String((counts['merge-duplicate-tags'] ?? 0) + (counts['apply-missing-tags'] ?? 0)),
        archive: String(counts['archive-empty'] ?? 0),
      }),
    });
  }

  private renderProposals(container: HTMLElement): void {
    const plan = this.currentPlan!;
    const proposalsList = container.createDiv({ cls: 'vaultend-organize-vault-proposals' });

    plan.proposals.forEach((proposal, index) => {
      this.renderProposal(proposalsList, proposal, index, plan.proposals.length);
    });
  }

  private renderProposal(
    container: HTMLElement,
    proposal: OrganizeVaultProposal,
    index: number,
    total: number,
  ): void {
    const card = container.createDiv({ cls: 'vaultend-organize-vault-proposal-card' });
    card.addClass(`vaultend-organize-vault-confidence-${proposal.confidenceLevel}`);

    if (proposal.status === 'applied') {
      card.addClass('vaultend-organize-vault-proposal-applied');
    } else if (proposal.status === 'rejected') {
      card.addClass('vaultend-organize-vault-proposal-rejected');
    } else if (proposal.status === 'approved') {
      card.addClass('vaultend-organize-vault-proposal-approved');
    }

    const header = card.createDiv({ cls: 'vaultend-organize-vault-proposal-header' });

    const indexLabel = header.createSpan({ cls: 'vaultend-organize-vault-proposal-index' });
    indexLabel.setText(`[${index + 1}/${total}]`);

    const typeLabel = header.createSpan({ cls: 'vaultend-organize-vault-proposal-type' });
    typeLabel.setText(t(`organizeVault.type.${proposal.type}` as any));

    const confidenceBadge = header.createSpan({ cls: 'vaultend-organize-vault-confidence-badge' });
    confidenceBadge.setText(`${CONFIDENCE_ICONS[proposal.confidenceLevel]} ${Math.round(proposal.confidence * 100)}%`);
    confidenceBadge.style.color = CONFIDENCE_COLORS[proposal.confidenceLevel];

    const target = card.createDiv({ cls: 'vaultend-organize-vault-proposal-target' });
    const targetLink = target.createEl('a', {
      text: proposal.targetPath as string,
      cls: 'vaultend-organize-vault-file-link',
    });
    targetLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.openFile(proposal.targetPath as string);
    });

    if (proposal.diffs.length > 0) {
      const diffContainer = card.createDiv({ cls: 'vaultend-organize-vault-diffs' });
      for (const diff of proposal.diffs) {
        const diffRow = diffContainer.createDiv({ cls: 'vaultend-organize-vault-diff-row' });
        diffRow.createSpan({ text: diff.field, cls: 'vaultend-organize-vault-diff-field' });
        const beforeSpan = diffRow.createSpan({ cls: 'vaultend-organize-vault-diff-before' });
        beforeSpan.setText(diff.before);
        diffRow.createSpan({ text: ' → ', cls: 'vaultend-organize-vault-diff-arrow' });
        const afterSpan = diffRow.createSpan({ cls: 'vaultend-organize-vault-diff-after' });
        afterSpan.setText(diff.after);
      }
    }

    const rationale = card.createDiv({ cls: 'vaultend-organize-vault-rationale' });
    rationale.createEl('span', { text: proposal.rationale, cls: 'vaultend-organize-vault-rationale-text' });

    if (proposal.affectedPaths.length > 1) {
      const affected = card.createDiv({ cls: 'vaultend-organize-vault-affected' });
      affected.createEl('span', {
        text: t('organizeVault.affected', { count: String(proposal.affectedPaths.length) }),
      });
    }

    if (proposal.status === 'pending' && this.currentPlan?.status === 'draft') {
      const actions = card.createDiv({ cls: 'vaultend-organize-vault-proposal-actions' });
      const approveBtn = actions.createEl('button', {
        text: t('organizeVault.approve'),
        cls: 'vaultend-organize-vault-btn-approve',
      });
      approveBtn.addEventListener('click', () => this.setProposalStatus(proposal.id, 'approved'));

      const rejectBtn = actions.createEl('button', {
        text: t('organizeVault.reject'),
        cls: 'vaultend-organize-vault-btn-reject',
      });
      rejectBtn.addEventListener('click', () => this.setProposalStatus(proposal.id, 'rejected'));
    }

    if (proposal.status === 'approved') {
      const statusTag = card.createSpan({ cls: 'vaultend-organize-vault-proposal-status-approved' });
      statusTag.setText(`✓ ${t('organizeVault.approve')}`);
    }
    if (proposal.status === 'rejected') {
      const statusTag = card.createSpan({ cls: 'vaultend-organize-vault-proposal-status-rejected' });
      statusTag.setText(`✗ ${t('organizeVault.reject')}`);
    }
  }

  private renderActions(container: HTMLElement): void {
    const plan = this.currentPlan!;
    const actionsBar = container.createDiv({ cls: 'vaultend-organize-vault-actions-bar' });

    if (plan.status === 'draft') {
      const approvedCount = getApprovedProposals(plan).length;
      const pendingCount = plan.proposals.filter(p => p.status === 'pending').length;

      if (pendingCount > 0) {
        new Setting(actionsBar)
          .addButton(btn => btn
            .setButtonText(t('organizeVault.approveAll'))
            .onClick(() => this.approveAll()));
      }

      new Setting(actionsBar)
        .addButton(btn => btn
          .setButtonText(`${t('organizeVault.applyApproved')} (${approvedCount})`)
          .setCta()
          .setDisabled(approvedCount === 0)
          .onClick(() => this.applyAll()));

      new Setting(actionsBar)
        .addButton(btn => btn
          .setButtonText(t('organizeVault.rescan'))
          .onClick(() => this.triggerScan()));
    }

    if (plan.status === 'applied') {
      new Setting(actionsBar)
        .addButton(btn => btn
          .setButtonText(t('organizeVault.rollback'))
          .setWarning()
          .onClick(() => this.rollbackAll()));

      new Setting(actionsBar)
        .addButton(btn => btn
          .setButtonText(t('organizeVault.rescan'))
          .onClick(() => this.triggerScan()));
    }

    if (plan.status === 'rolled-back') {
      new Setting(actionsBar)
        .addButton(btn => btn
          .setButtonText(t('organizeVault.rescan'))
          .setCta()
          .onClick(() => this.triggerScan()));
    }
  }

  private async setProposalStatus(
    proposalId: string,
    status: 'approved' | 'rejected',
  ): Promise<void> {
    if (!this.currentPlan) return;
    const updated = await this.store.updateProposalStatus(
      this.currentPlan.id,
      proposalId,
      status,
    );
    if (updated) {
      this.currentPlan = updated;
      this.render();
    }
  }

  private async approveAll(): Promise<void> {
    if (!this.currentPlan) return;
    for (const proposal of this.currentPlan.proposals) {
      if (proposal.status === 'pending') {
        await this.store.updateProposalStatus(
          this.currentPlan.id,
          proposal.id,
          'approved',
        );
      }
    }
    this.currentPlan = await this.store.load(this.currentPlan.id);
    this.render();
  }

  private async applyAll(): Promise<void> {
    if (!this.currentPlan) return;

    const approved = getApprovedProposals(this.currentPlan);
    if (approved.length === 0) {
      new Notice(t('organizeVault.noApproved'));
      return;
    }

    try {
      const result = await this.applyPlan.execute(this.currentPlan.id);
      if (result) {
        new Notice(t('organizeVault.applyResult', {
          applied: String(result.appliedCount),
          failed: String(result.failedCount),
        }));
        this.currentPlan = await this.store.load(this.currentPlan.id);
        this.render();
      }
    } catch (err) {
      new Notice(t('organizeVault.scanFailed', { error: localizeError(err) }));
    }
  }

  private async rollbackAll(): Promise<void> {
    if (!this.currentPlan) return;
    try {
      const result = await this.rollbackPlan.execute(this.currentPlan.id);
      if (result) {
        new Notice(t('organizeVault.rollbackResult', {
          count: String(result.rolledBackCount),
        }));
        this.currentPlan = await this.store.load(this.currentPlan.id);
        this.render();
      }
    } catch (err) {
      new Notice(t('organizeVault.scanFailed', { error: localizeError(err) }));
    }
  }
}
