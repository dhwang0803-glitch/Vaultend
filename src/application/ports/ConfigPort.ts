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
  // AI 공급자 설정
  readonly aiProvider: 'openai' | 'gemini';
  readonly aiApiKey: string;
  readonly aiModel: string;
  readonly aiMaxTokens: number;
  readonly aiTemperature: number;

  // Inbox 설정
  readonly inboxFolder: string;
  readonly autoApplyInbox: boolean;

  // Quick Ask 설정
  readonly defaultSaveFolder: string;
  readonly defaultSaveTarget: 'new-note' | 'daily-note';
  readonly maxContextChunks: number;

  // Daily Note 설정
  readonly dailyNoteFormat: string;
  readonly dailyNoteFolder: string;
  readonly dailyNoteTemplate?: string;

  // 유지보수 설정
  readonly maintenanceEnabled: boolean;
  readonly maintenanceIntervalMinutes: number;

  // 프라이버시
  readonly privacyRules: ReadonlyArray<PrivacyRule>;

  // 알려진 태그 (자동완성/제안용)
  readonly knownTags: ReadonlyArray<TagName>;

  // 비용 추적
  readonly trackTokenUsage: boolean;
  readonly monthlyBudgetUsd?: number;
}
