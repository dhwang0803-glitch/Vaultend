export interface TagGroupCacheMeta {
  readonly provider: string;
  readonly model: string;
  readonly version: number;
}

export type CachedTagGroupType = 'merge' | 'nest' | 'relate';

export interface CachedTagGroup {
  readonly canonical: string;
  readonly variants: ReadonlyArray<string>;
  readonly source: 'normalization' | 'llm';
  readonly reason?: string;
  readonly type?: CachedTagGroupType;
}

export interface TagGroupCachePort {
  load(): Promise<void>;
  flush(): Promise<void>;

  getGroups(): ReadonlyArray<CachedTagGroup>;
  getProcessedTags(): ReadonlySet<string>;

  setGroups(groups: ReadonlyArray<CachedTagGroup>, processedTags: ReadonlySet<string>): void;

  getMeta(): TagGroupCacheMeta | null;
  setMeta(meta: Omit<TagGroupCacheMeta, 'version'>): void;
  isCompatible(provider: string, model: string): boolean;

  clear(): Promise<void>;
}
