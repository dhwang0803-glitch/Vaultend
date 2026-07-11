/**
 * 플러그인 전역 상수 정의.
 */

/** 사이드바 뷰 타입 ID */
export const MAINTENANCE_LOG_VIEW_TYPE = 'knowledge-maintenance-log';
export const MAINTENANCE_RESULT_VIEW_TYPE = 'knowledge-maintenance-result';
export const INBOX_STATUS_VIEW_TYPE = 'knowledge-maintenance-inbox-status';

/** 플러그인 내부 데이터 폴더 경로 */
export const PLUGIN_DATA_FOLDER = '.knowledge-maintenance';
export const SEARCH_INDEX_PATH = `${PLUGIN_DATA_FOLDER}/search-index.json`;
export const HISTORY_FOLDER = `${PLUGIN_DATA_FOLDER}/history`;

/** 기본 설정값 */
export const DEFAULT_INBOX_FOLDER = 'Inbox';
export const DEFAULT_SAVE_FOLDER = 'QuickAsk';
export const DEFAULT_DAILY_NOTE_FOLDER = 'DailyNotes';
export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_AI_MODEL = 'gpt-4o';
export const DEFAULT_AI_MAX_TOKENS = 2048;
export const DEFAULT_AI_TEMPERATURE = 0.7;
export const DEFAULT_MAINTENANCE_INTERVAL_MINUTES = 60;
export const DEFAULT_MAX_CONTEXT_CHUNKS = 5;
export const DEFAULT_DAILY_NOTE_SIZE_LIMIT_KB = 200;
export const DEFAULT_ARCHIVE_FOLDER = 'Archive';

/** 기본 로캘 */
export const DEFAULT_LOCALE: 'auto' | 'en' | 'ko' = 'auto';

/** 디바운스 설정 */
export const INBOX_DEBOUNCE_MS = 2000;

/** 명령 ID */
export const COMMAND_QUICK_ASK = 'quick-ask';
export const COMMAND_CAPTURE_CLIPBOARD = 'capture-clipboard';
export const COMMAND_ORGANIZE_CURRENT_NOTE = 'organize-current-note';
export const COMMAND_RUN_MAINTENANCE = 'run-maintenance';
export const COMMAND_RUN_INBOX_PROCESS = 'run-inbox-process';
export const COMMAND_OPEN_MAINTENANCE_LOG = 'open-maintenance-log';
export const COMMAND_OPEN_INBOX_STATUS = 'open-inbox-status';
