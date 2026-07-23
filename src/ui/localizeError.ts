import { t } from '../i18n';
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
    return t('error.noteNotFound', { id: err.identifier });
  }
  if (err instanceof DuplicateNoteError) {
    return t('error.duplicateNote', { path: err.path });
  }
  if (err instanceof InvalidNoteContentError) {
    return t('error.invalidContent', { reason: err.reason });
  }
  if (err instanceof RateLimitError) {
    return t('error.rateLimit', { ms: err.retryAfterMs });
  }
  if (err instanceof PrivacyViolationError) {
    return t('error.privacyViolation', { rule: err.ruleName });
  }
  if (err instanceof AIProviderError) {
    return t('error.aiProvider', { provider: err.provider, status: err.statusCode, detail: err.detail });
  }
  if (err instanceof HistoryEntryNotFoundError) {
    return t('error.historyNotFound', { id: err.entryId });
  }

  return err.message;
}
