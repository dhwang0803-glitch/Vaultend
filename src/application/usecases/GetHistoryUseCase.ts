import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { HistoryPort, HistoryFilter } from '../ports/HistoryPort';

export type { HistoryFilter };

export class GetHistoryUseCase {
  constructor(
    private readonly history: HistoryPort,
  ) {}

  async execute(filter?: HistoryFilter): Promise<ReadonlyArray<HistoryEntry>> {
    return this.history.list(filter);
  }
}
