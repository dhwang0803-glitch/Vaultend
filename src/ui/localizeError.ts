import { t, LocaleKey } from '../i18n';
import {
  NoteNotFoundError,
  DuplicateNoteError,
  InvalidNoteContentError,
  AIProviderError,
  PrivacyViolationError,
  RateLimitError,
  HistoryEntryNotFoundError,
} from '../domain/errors/DomainErrors';

export function localizeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  if (err instanceof NoteNotFoundError) {
    return t('error.noteNotFound' as LocaleKey, { id: err.identifier });
  }
  if (err instanceof DuplicateNoteError) {
    return t('error.duplicateNote' as LocaleKey, { path: err.path });
  }
  if (err instanceof InvalidNoteContentError) {
    return t('error.invalidContent' as LocaleKey, { reason: err.reason });
  }
  if (err instanceof RateLimitError) {
    return t('error.rateLimit' as LocaleKey, { ms: err.retryAfterMs });
  }
  if (err instanceof PrivacyViolationError) {
    return t('error.privacyViolation' as LocaleKey, { rule: err.ruleName });
  }
  if (err instanceof AIProviderError) {
    return t('error.aiProvider' as LocaleKey, { provider: err.provider, status: err.statusCode, detail: err.detail });
  }
  if (err instanceof HistoryEntryNotFoundError) {
    return t('error.historyNotFound' as LocaleKey, { id: err.entryId });
  }

  return err.message;
}
