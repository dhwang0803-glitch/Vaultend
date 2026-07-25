import { OrganizeHashPort } from '../../application/ports/OrganizeHashPort';
import { VaultAccessPort } from '../../application/ports/VaultAccessPort';
import { NotePath } from '../../domain/values/NotePath';
import { ORGANIZE_HASH_PATH } from '../../constants';

interface HashData {
  hashes: Record<string, string>;
}

export class FileOrganizeHashAdapter implements OrganizeHashPort {
  private hashMap = new Map<string, string>();
  private loaded = false;

  constructor(private readonly vault: VaultAccessPort) {}

  async getHash(notePath: NotePath): Promise<string | null> {
    await this.ensureLoaded();
    return this.hashMap.get(notePath) ?? null;
  }

  async setHash(notePath: NotePath, hash: string): Promise<void> {
    await this.ensureLoaded();
    this.hashMap.set(notePath, hash);
  }

  async removeHash(notePath: NotePath): Promise<void> {
    await this.ensureLoaded();
    this.hashMap.delete(notePath);
  }

  async persist(): Promise<void> {
    const data: HashData = {
      hashes: Object.fromEntries(this.hashMap),
    };
    await this.vault.writeFileRaw(ORGANIZE_HASH_PATH, JSON.stringify(data));
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const raw = await this.vault.readFileRaw(ORGANIZE_HASH_PATH);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as HashData;
      if (data.hashes && typeof data.hashes === 'object') {
        for (const [k, v] of Object.entries(data.hashes)) {
          this.hashMap.set(k, v);
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }
}
