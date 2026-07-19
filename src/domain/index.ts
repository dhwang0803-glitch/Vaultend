// Value Objects
export type {
  NoteId,
  NotePath,
  NoteTitle,
  ChunkText,
  HeadingPath,
  TagName,
  Timestamp,
  SeverityLevel,
} from './values';
export {
  createNoteId, noteIdToString,
  createNotePath, notePathToString,
  createNoteTitle,
  createChunkText,
  createHeadingPath,
  createTagName,
  createTimestamp, timestampNow,
  ISSUE_SEVERITY, SEVERITY_ORDER, getSeverity,
} from './values';

// Models
export type {
  Note,
  NoteChunk,
  NoteMetadata,
  SaveTarget, NewNote, AppendToNote, DailyNote,
  TokenUsage,
  OrganizeResult, MaintenancePlan, DuplicatePair, MissingTagSuggestion, BrokenLink, DuplicateTagGroup,
  PrivacyRule, PrivacyRuleType,
  HistoryEntry, HistoryAction,
  MergeDuplicateTags,
} from './models';
export {
  createNote,
  isNewNote, isAppendToNote, isDailyNote,
  isNoteAllowedByRules,
} from './models';

// Errors
export {
  NoteNotFoundError,
  DuplicateNoteError,
  InvalidNoteContentError,
  AIProviderError,
  PrivacyViolationError,
  RateLimitError,
} from './errors/DomainErrors';
