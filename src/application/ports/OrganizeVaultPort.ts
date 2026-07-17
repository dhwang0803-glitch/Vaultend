import { OrganizeVaultPlan, ProposalStatus, OrganizeVaultStatus } from '../../domain/models/OrganizeVaultPlan';

export interface OrganizeVaultPort {
  save(plan: OrganizeVaultPlan): Promise<void>;
  load(id: string): Promise<OrganizeVaultPlan | null>;
  list(): Promise<ReadonlyArray<OrganizeVaultPlan>>;
  delete(id: string): Promise<void>;
  updateProposalStatus(planId: string, proposalId: string, status: ProposalStatus): Promise<OrganizeVaultPlan | null>;
  updateStatus(planId: string, status: OrganizeVaultStatus): Promise<OrganizeVaultPlan | null>;
}
