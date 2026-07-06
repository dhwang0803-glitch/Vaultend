import { HistoryEntry } from '../../domain/models/HistoryEntry';
import { Timestamp } from '../../domain/values/Timestamp';

/**
 * 변경 이력 포트 — 플러그인이 수행한 작업의 기록과 조회.
 */
export interface HistoryPort {
  /** 새 이력 항목 기록. */
  record(entry: HistoryEntry): Promise<void>;

  /** 이력 조회 (필터 옵션 적용). */
  list(filter?: HistoryFilter): Promise<ReadonlyArray<HistoryEntry>>;

  /** 특정 이력 항목의 변경을 되돌린다. */
  undo(entryId: string): Promise<void>;
}

export interface HistoryFilter {
  readonly since?: Timestamp;
  readonly until?: Timestamp;
  readonly action?: string;
  readonly limit?: number;
}
