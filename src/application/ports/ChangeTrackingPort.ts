import { NotePath } from '../../domain/values/NotePath';

export interface ChangeTrackingPort {
  markDirty(notePath: NotePath): Promise<void>;
  markClean(notePath: NotePath): Promise<void>;
  getDirtySet(): Promise<ReadonlySet<NotePath>>;
  clearAll(): Promise<void>;
  persist(): Promise<void>;
  getLastScanTimestamp(): Promise<number | null>;
  setLastScanTimestamp(ts: number): Promise<void>;
}
