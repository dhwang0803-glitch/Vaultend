import { ChangeTrackingPort } from '../../application/ports/ChangeTrackingPort';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { NotePath, createNotePath } from '../../domain/values/NotePath';
import { DIRTY_SET_PATH } from '../../constants';

interface DirtySetData {
  dirtyPaths: string[];
  lastScanTimestamp: number | null;
}

export class FileChangeTrackingAdapter implements ChangeTrackingPort {
  private dirtySet: Set<NotePath> = new Set();
  private lastScanTimestamp: number | null = null;
  private loaded = false;

  constructor(private readonly vault: VaultAccessPort) {}

  async markDirty(notePath: NotePath): Promise<void> {
    await this.ensureLoaded();
    this.dirtySet.add(notePath);
  }

  async markClean(notePath: NotePath): Promise<void> {
    await this.ensureLoaded();
    this.dirtySet.delete(notePath);
  }

  async getDirtySet(): Promise<ReadonlySet<NotePath>> {
    await this.ensureLoaded();
    return this.dirtySet;
  }

  async clearAll(): Promise<void> {
    this.dirtySet.clear();
    await this.persist();
  }

  async persist(): Promise<void> {
    const data: DirtySetData = {
      dirtyPaths: [...this.dirtySet].map(p => p as string),
      lastScanTimestamp: this.lastScanTimestamp,
    };
    await this.vault.writeFileRaw(DIRTY_SET_PATH, JSON.stringify(data));
  }

  async getLastScanTimestamp(): Promise<number | null> {
    await this.ensureLoaded();
    return this.lastScanTimestamp;
  }

  async setLastScanTimestamp(ts: number): Promise<void> {
    this.lastScanTimestamp = ts;
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const raw = await this.vault.readFileRaw(DIRTY_SET_PATH);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as DirtySetData;
      if (Array.isArray(data.dirtyPaths)) {
        for (const p of data.dirtyPaths) {
          this.dirtySet.add(createNotePath(p));
        }
      }
      this.lastScanTimestamp = data.lastScanTimestamp ?? null;
    } catch {
      // Corrupted file — start fresh
    }
  }
}
