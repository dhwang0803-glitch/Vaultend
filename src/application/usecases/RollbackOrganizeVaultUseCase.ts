import { withPlanStatus } from '../../domain/models/OrganizeVaultPlan';
import { HistoryPort } from '../ports/HistoryPort';
import { ClockPort } from '../ports/ClockPort';
import { OrganizeVaultPort } from '../ports/OrganizeVaultPort';

export interface RollbackOrganizeVaultResult {
  readonly rolledBackCount: number;
  readonly failedCount: number;
}

export class RollbackOrganizeVaultUseCase {
  constructor(
    private readonly history: HistoryPort,
    private readonly clock: ClockPort,
    private readonly store: OrganizeVaultPort,
  ) {}

  async execute(planId: string): Promise<RollbackOrganizeVaultResult | null> {
    const plan = await this.store.load(planId);
    if (!plan || plan.status !== 'applied') return null;

    const transactionId = plan.transactionId;
    if (!transactionId) return null;

    const allEntries = await this.history.list();
    const txEntries = allEntries
      .filter(e => (e.metadata as Record<string, unknown>)?.transactionId === transactionId)
      .sort((a, b) => (b.timestamp as number) - (a.timestamp as number));

    let rolledBackCount = 0;
    let failedCount = 0;

    for (const entry of txEntries) {
      try {
        await this.history.undo(entry.id);
        rolledBackCount++;
      } catch {
        failedCount++;
      }
    }

    const updated = withPlanStatus(plan, 'rolled-back', this.clock.now());
    await this.store.save(updated);

    return { rolledBackCount, failedCount };
  }
}
