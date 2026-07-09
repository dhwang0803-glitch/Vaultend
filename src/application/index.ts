// src/application/index.ts

// Ports
export type {
  AIProviderPort,
  CompletionRequest,
  CompletionResponse,
  ClassificationRequest,
  ClassificationResponse,
} from './ports/AIProviderPort';

export type {
  VaultAccessPort,
  VaultEvent,
  VaultEventHandler,
} from './ports/VaultAccessPort';

export type {
  SearchIndexPort,
  SearchResult,
} from './ports/SearchIndexPort';

export type {
  HistoryPort,
} from './ports/HistoryPort';
export type { HistoryFilter as HistoryPortFilter } from './ports/HistoryPort';

export type {
  ConfigPort,
  PluginSettings,
} from './ports/ConfigPort';

export type { ClipboardPort } from './ports/ClipboardPort';

export type { ClockPort } from './ports/ClockPort';

// Use Cases
export { QuickAskUseCase } from './usecases/QuickAskUseCase';
export { OrganizeNoteUseCase } from './usecases/OrganizeNoteUseCase';
export { RunInboxProcessUseCase } from './usecases/RunInboxProcessUseCase';
export type { InboxProcessResult } from './usecases/RunInboxProcessUseCase';
export { RunMaintenanceUseCase } from './usecases/RunMaintenanceUseCase';
export { SaveNoteUseCase } from './usecases/SaveNoteUseCase';
export type { SaveNoteRequest } from './usecases/SaveNoteUseCase';
export { CaptureClipboardUseCase } from './usecases/CaptureClipboardUseCase';
export { GetHistoryUseCase } from './usecases/GetHistoryUseCase';
export type { HistoryFilter } from './usecases/GetHistoryUseCase';
