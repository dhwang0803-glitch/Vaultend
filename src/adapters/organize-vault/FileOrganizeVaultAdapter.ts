import { OrganizeVaultPort } from '../../application/ports/OrganizeVaultPort';
import {
  OrganizeVaultPlan,
  OrganizeVaultStatus,
  ProposalStatus,
  withProposalStatus,
} from '../../domain/models/OrganizeVaultPlan';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { ORGANIZE_VAULT_FOLDER } from '../../constants';

export class FileOrganizeVaultAdapter implements OrganizeVaultPort {
  constructor(
    private readonly vault: VaultAccessPort,
  ) {}

  async save(plan: OrganizeVaultPlan): Promise<void> {
    const filePath = this.getFilePath(plan.id);
    await this.vault.writeFileRaw(filePath, JSON.stringify(plan, null, 2));
  }

  async load(id: string): Promise<OrganizeVaultPlan | null> {
    const filePath = this.getFilePath(id);
    const raw = await this.vault.readFileRaw(filePath);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OrganizeVaultPlan;
    } catch {
      return null;
    }
  }

  async list(): Promise<ReadonlyArray<OrganizeVaultPlan>> {
    const files = await this.vault.listFiles(ORGANIZE_VAULT_FOLDER, 'json');
    const results: OrganizeVaultPlan[] = [];
    for (const file of files) {
      const raw = await this.vault.readFileRaw(file);
      if (!raw) continue;
      try {
        results.push(JSON.parse(raw) as OrganizeVaultPlan);
      } catch {
        // skip corrupt files
      }
    }
    return results.sort(
      (a, b) => (b.timestamp as number) - (a.timestamp as number),
    );
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getFilePath(id);
    const raw = await this.vault.readFileRaw(filePath);
    if (raw !== null) {
      await this.vault.writeFileRaw(filePath, '');
    }
  }

  async updateProposalStatus(
    planId: string,
    proposalId: string,
    status: ProposalStatus,
  ): Promise<OrganizeVaultPlan | null> {
    const plan = await this.load(planId);
    if (!plan) return null;

    const updatedProposals = plan.proposals.map(p =>
      p.id === proposalId ? withProposalStatus(p, status) : p,
    );

    const updated: OrganizeVaultPlan = { ...plan, proposals: updatedProposals };
    await this.save(updated);
    return updated;
  }

  async updateStatus(
    planId: string,
    status: OrganizeVaultStatus,
  ): Promise<OrganizeVaultPlan | null> {
    const plan = await this.load(planId);
    if (!plan) return null;

    const updated: OrganizeVaultPlan = { ...plan, status };
    await this.save(updated);
    return updated;
  }

  private getFilePath(id: string): string {
    return `${ORGANIZE_VAULT_FOLDER}/${id}.json`;
  }
}
