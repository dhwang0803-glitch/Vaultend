import type { NotePath } from '../../domain/values/NotePath';
import type { OrganizeResult } from '../../domain/models/OrganizeModels';

export interface CachedOrganizeEntry {
  readonly contentHash: string;
  readonly result: OrganizeResult;
}

export interface OrganizeResultCachePort {
  get(notePath: NotePath): CachedOrganizeEntry | undefined;
  put(notePath: NotePath, contentHash: string, result: OrganizeResult): void;
  delete(notePath: NotePath): void;
  clear(): void;
  size(): number;
}
