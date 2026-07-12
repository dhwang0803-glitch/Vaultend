import { PrivacyRule } from '../../domain/models/PrivacyRule';
import { TagName } from '../../domain/values/TagName';

/**
 * 설정 포트 — 플러그인 설정의 읽기/저장을 추상화한다.
 */
export interface ConfigPort {
  /** 현재 설정 반환. */
  getSettings(): Promise<PluginSettings>;

  /** 설정 저장 (전체 교체). */
  saveSettings(settings: PluginSettings): Promise<void>;

  /** 설정 부분 갱신. */
  updateSettings(partial: Partial<PluginSettings>): Promise<void>;
}

/**
 * 플러그인 설정 — 모든 사용자 설정을 포함한다.
 * 이 인터페이스는 포트 계층에 위치하지만, 구조적으로 도메인 모델이기도 하다.
 */
export interface PluginSettings {
  // AI provider settings
  readonly aiProvider: 'openai' | 'gemini';
  readonly aiApiKey: string;
  readonly aiModel: string;
  readonly aiMaxTokens: number;
  readonly aiTemperature: number;

  // Inbox settings
  readonly inboxFolder: string;
  readonly autoApplyInbox: boolean;

  // Quick Ask settings
  readonly defaultSaveFolder: string;
  readonly defaultSaveTarget: 'new-note' | 'daily-note';
  readonly quickAskSaveMode: 'timestamp' | 'daily-note';
  readonly dailyNoteSizeLimitKB: number;
  readonly maxContextChunks: number;

  // Daily Note settings
  readonly dailyNoteFormat: string;
  readonly dailyNoteFolder: string;
  readonly dailyNoteTemplate?: string;

  // Maintenance settings
  readonly maintenanceEnabled: boolean;
  readonly maintenanceIntervalMinutes: number;
  readonly smartScheduling: boolean;
  readonly maintenanceExcludeFolders: ReadonlyArray<string>;
  readonly maintenanceExcludeFiles: ReadonlyArray<string>;
  readonly maintenanceExcludeTags: ReadonlyArray<string>;
  readonly maintenanceArchiveFolder: string;

  // Inbox confidence gating
  readonly inboxConfidenceThreshold: number;

  // Privacy
  readonly privacyRules: ReadonlyArray<PrivacyRule>;

  // Known tags (for autocomplete/suggestions)
  readonly knownTags: ReadonlyArray<TagName>;

  // Cost tracking
  readonly trackTokenUsage: boolean;
  readonly monthlyBudgetUsd?: number;

  // Embeddings
  readonly embeddingsEnabled: boolean;
  readonly embeddingsModel: string;

  // Hybrid search (RRF) tuning
  readonly rrfEmbeddingWeight: number;
  readonly rrfK: number;

  // Language
  readonly locale: 'auto' | 'en' | 'ko';
}
