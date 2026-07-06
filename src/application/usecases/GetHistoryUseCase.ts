import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { HistoryPort } from '../ports/HistoryPort';
import { Timestamp } from '../../domain/values/Timestamp';

export interface HistoryFilter {
  readonly since?: Timestamp;
  readonly until?: Timestamp;
  readonly action?: string;
  readonly limit?: number;
}

export class GetHistoryUseCase {
  constructor(
    private readonly history: HistoryPort,
  ) {}

  /**
   * 변경 이력을 조회한다. 필터 옵션으로 기간/액션 유형별 조회 가능.
   */
  async execute(filter?: HistoryFilter): Promise<ReadonlyArray<HistoryEntry>> {
    return this.history.list(filter);
  }
}
