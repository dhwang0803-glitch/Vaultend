import { describe, it, expect } from 'vitest';
import {
  NoteNotFoundError,
  DuplicateNoteError,
  InvalidNoteContentError,
  AIProviderError,
  PrivacyViolationError,
  RateLimitError,
  HistoryEntryNotFoundError,
} from '../DomainErrors';

describe('DomainErrors', () => {
  it('NoteNotFoundError — name, message, identifier 설정', () => {
    const err = new NoteNotFoundError('test.md');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NoteNotFoundError');
    expect(err.identifier).toBe('test.md');
    expect(err.message).toContain('test.md');
  });

  it('DuplicateNoteError — name, message, path 설정', () => {
    const err = new DuplicateNoteError('dup.md');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DuplicateNoteError');
    expect(err.path).toBe('dup.md');
    expect(err.message).toContain('dup.md');
  });

  it('InvalidNoteContentError — reason 포함', () => {
    const err = new InvalidNoteContentError('empty content');
    expect(err.name).toBe('InvalidNoteContentError');
    expect(err.reason).toBe('empty content');
    expect(err.message).toContain('empty content');
  });

  it('AIProviderError — provider, statusCode, detail 설정', () => {
    const err = new AIProviderError('openai', 429, 'rate limited');
    expect(err.name).toBe('AIProviderError');
    expect(err.provider).toBe('openai');
    expect(err.statusCode).toBe(429);
    expect(err.detail).toBe('rate limited');
    expect(err.message).toContain('openai');
    expect(err.message).toContain('429');
  });

  it('PrivacyViolationError — ruleName 포함', () => {
    const err = new PrivacyViolationError('secret-rule');
    expect(err.name).toBe('PrivacyViolationError');
    expect(err.ruleName).toBe('secret-rule');
  });

  it('RateLimitError — retryAfterMs 포함', () => {
    const err = new RateLimitError(5000);
    expect(err.name).toBe('RateLimitError');
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toContain('5000');
  });

  it('HistoryEntryNotFoundError — entryId 포함', () => {
    const err = new HistoryEntryNotFoundError('entry-abc');
    expect(err.name).toBe('HistoryEntryNotFoundError');
    expect(err.entryId).toBe('entry-abc');
    expect(err.message).toContain('entry-abc');
  });
});
