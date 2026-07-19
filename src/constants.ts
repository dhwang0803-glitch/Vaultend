/**
 * 플러그인 전역 상수 정의.
 */

/** Workspace 이벤트 */
export const HISTORY_CHANGED_EVENT = 'vaultend:history-changed';

/** 사이드바 뷰 타입 ID */
export const MAINTENANCE_LOG_VIEW_TYPE = 'vaultend-log';
export const MAINTENANCE_RESULT_VIEW_TYPE = 'vaultend-result';
export const ORGANIZE_FOLDER_VIEW_TYPE = 'vaultend-organize-folder';
export const ORGANIZE_VAULT_VIEW_TYPE = 'vaultend-organize-vault';

/** 플러그인 내부 데이터 폴더 경로 */
export const PLUGIN_DATA_FOLDER = '.vaultend';
export const SEARCH_INDEX_PATH = `${PLUGIN_DATA_FOLDER}/search-index.json`;
export const DIRTY_SET_PATH = `${PLUGIN_DATA_FOLDER}/dirty-set.json`;
export const TFIDF_CORPUS_PATH = `${PLUGIN_DATA_FOLDER}/tfidf-corpus.json`;
export const EMBEDDINGS_PATH = `${PLUGIN_DATA_FOLDER}/embeddings.json`;
export const HISTORY_FOLDER = `${PLUGIN_DATA_FOLDER}/history`;
export const ORGANIZE_VAULT_FOLDER = `${PLUGIN_DATA_FOLDER}/organize-vault`;

/** 기본 설정값 */
export const DEFAULT_SAVE_FOLDER = 'QuickAsk';
export const DEFAULT_DAILY_NOTE_FOLDER = 'DailyNotes';
export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_AI_MODEL = 'gpt-4o';
export const DEFAULT_AI_MAX_TOKENS = 8192;
export const DEFAULT_AI_TEMPERATURE = 0.7;
export const DEFAULT_MAINTENANCE_INTERVAL_MINUTES = 60;
export const DEFAULT_MAX_CONTEXT_CHUNKS = 5;
export const DEFAULT_DAILY_NOTE_SIZE_LIMIT_KB = 200;
export const DEFAULT_ARCHIVE_FOLDER = 'Archive';

/** 기본 로캘 */
export const DEFAULT_LOCALE: 'auto' | 'en' | 'ko' = 'auto';

/** 명령 ID */
export const COMMAND_QUICK_ASK = 'quick-ask';

export const COMMAND_ORGANIZE_CURRENT_NOTE = 'organize-current-note';
export const COMMAND_RUN_MAINTENANCE = 'run-maintenance';
export const COMMAND_ORGANIZE_FOLDER = 'organize-folder';
export const COMMAND_OPEN_MAINTENANCE_LOG = 'open-maintenance-log';

/** Tag Embedding Cache */
export const TAG_EMBEDDINGS_PATH = `${PLUGIN_DATA_FOLDER}/tag-embeddings.json`;

/** Preference Learning 상수 */
export const PREFERENCES_PATH = `${PLUGIN_DATA_FOLDER}/preferences.json`;
export const PREFERENCE_SIGNAL_MAX = 200;
export const PREFERENCE_FEWSHOT_MAX = 10;
export const PREFERENCE_RULE_THRESHOLD = 3;

/** Refactor 파이프라인 상수 */
export const REFACTOR_BATCH_SIZE = 50;
export const REFACTOR_CONTENT_PREVIEW = 300;
export const FLEETING_WORD_COUNT_THRESHOLD = 150;
export const FLEETING_MIN_CLUSTER_SIZE = 2;
export const REFACTOR_MAX_TAGS_IN_PROMPT = 200;
export const REORG_LOW_CONFIDENCE_THRESHOLD = 0.5;
export const REORG_TIER2_TRIGGER_RATIO = 0.3;

/** Vault Refactor 재설계 상수 */
export const COMMAND_VAULT_REFACTOR = 'vault-refactor';
export const MISPLACED_AFFINITY_THRESHOLD = 0.3;
export const MISPLACED_BATCH_SIZE = 30;
export const BLOATED_FOLDER_THRESHOLD = 30;
export const THIN_FOLDER_THRESHOLD = 3;
export const PROMOTE_MATURITY_AGE_DAYS = 7;
export const PROMOTE_MIN_WORD_COUNT = 100;
export const DEFAULT_FLEETING_FOLDERS: ReadonlyArray<string> = ['Inbox', 'Fleeting'];
