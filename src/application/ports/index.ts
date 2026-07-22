// src/application/ports/index.ts

export type {
  AIProviderPort,
  CompletionRequest,
  CompletionResponse,
  ClassificationRequest,
  ClassificationResponse,
} from './AIProviderPort';

export type {
  VaultAccessPort,
  VaultEvent,
  VaultEventHandler,
} from './VaultAccessPort';

export type {
  SearchIndexPort,
  SearchResult,
} from './SearchIndexPort';

export type {
  HistoryPort,
  HistoryFilter,
} from './HistoryPort';

export type {
  ConfigPort,
  PluginSettings,
} from './ConfigPort';

export type { ClockPort } from './ClockPort';
export type { TagEmbeddingCachePort, TagEmbeddingCacheMeta } from './TagEmbeddingCachePort';
