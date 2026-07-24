import type { NotePath } from '../../domain/values/NotePath';
import type { OrganizeResult } from '../../domain/models/OrganizeModels';
import type { CachedOrganizeEntry, OrganizeResultCachePort } from '../../application/ports/OrganizeResultCachePort';

export class InMemoryOrganizeResultCacheAdapter implements OrganizeResultCachePort {
  private readonly cache = new Map<NotePath, CachedOrganizeEntry>();

  get(notePath: NotePath): CachedOrganizeEntry | undefined {
    return this.cache.get(notePath);
  }

  put(notePath: NotePath, contentHash: string, result: OrganizeResult): void {
    this.cache.set(notePath, { contentHash, result });
  }

  delete(notePath: NotePath): void {
    this.cache.delete(notePath);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
