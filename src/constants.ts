/**
 * 플러그인 전역 상수 정의.
 */

/** Workspace 이벤트 */
export const HISTORY_CHANGED_EVENT = 'vaultend:history-changed';

/** 사이드바 뷰 타입 ID */
export const MAINTENANCE_LOG_VIEW_TYPE = 'vaultend-log';
export const MAINTENANCE_RESULT_VIEW_TYPE = 'vaultend-result';
export const ORGANIZE_FOLDER_VIEW_TYPE = 'vaultend-organize-folder';
export const ORGANIZE_TAGS_VIEW_TYPE = 'vaultend-organize-tags';

/** 플러그인 내부 데이터 폴더 경로 */
export const PLUGIN_DATA_FOLDER = '.vaultend';
export const SEARCH_INDEX_PATH = `${PLUGIN_DATA_FOLDER}/search-index.json`;
export const DIRTY_SET_PATH = `${PLUGIN_DATA_FOLDER}/dirty-set.json`;
export const TFIDF_CORPUS_PATH = `${PLUGIN_DATA_FOLDER}/tfidf-corpus.json`;
export const EMBEDDINGS_PATH = `${PLUGIN_DATA_FOLDER}/embeddings.json`;
export const HISTORY_FOLDER = `${PLUGIN_DATA_FOLDER}/history`;
export const TAG_GROUPS_PATH = `${PLUGIN_DATA_FOLDER}/tag-groups.json`;

/** 기본 설정값 */
export const DEFAULT_SAVE_FOLDER = 'Vaultend';
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
export const COMMAND_ORGANIZE_CURRENT_NOTE = 'organize-current-note';
export const COMMAND_RUN_MAINTENANCE = 'run-maintenance';
export const COMMAND_ORGANIZE_FOLDER = 'organize-folder';
export const COMMAND_ORGANIZE_TAGS = 'organize-tags';
export const COMMAND_OPEN_MAINTENANCE_LOG = 'open-maintenance-log';

/** Tag Embedding Cache */
export const TAG_EMBEDDINGS_PATH = `${PLUGIN_DATA_FOLDER}/tag-embeddings.json`;

/** Note Embedding Cache */
export const NOTE_EMBEDDINGS_PATH = `${PLUGIN_DATA_FOLDER}/note-embeddings.json`;

/** Organize Folder 스마트 필터링 상수 */
export const ORGANIZE_MIN_WORD_COUNT = 50;
export const ORGANIZE_SUFFICIENT_LINKS = 3;

/** Organize Tags 상수 */
export const TAG_GROUPING_BATCH_SIZE = 200;

