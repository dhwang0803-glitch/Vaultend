export class NoteNotFoundError extends Error {
  constructor(readonly identifier: string) {
    super(`Note not found: ${identifier}`);
    this.name = 'NoteNotFoundError';
  }
}

export class DuplicateNoteError extends Error {
  constructor(readonly path: string) {
    super(`Note already exists: ${path}`);
    this.name = 'DuplicateNoteError';
  }
}

export class InvalidNoteContentError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid note content: ${reason}`);
    this.name = 'InvalidNoteContentError';
  }
}

export class AIProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly statusCode: number,
    readonly detail: string,
  ) {
    super(`AI provider error [${provider}] (${statusCode}): ${detail}`);
    this.name = 'AIProviderError';
  }
}

export class PrivacyViolationError extends Error {
  constructor(readonly ruleName: string) {
    super(`Privacy rule violation: ${ruleName}`);
    this.name = 'PrivacyViolationError';
  }
}

export class AIParseError extends AIProviderError {
  constructor(provider: string, rawContent: string) {
    super(provider, 0, `JSON parse failed after retries. Raw: ${rawContent.slice(0, 200)}`);
    this.name = 'AIParseError';
  }
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Rate limit exceeded — retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}

export class HistoryEntryNotFoundError extends Error {
  constructor(readonly entryId: string) {
    super(`History entry not found: ${entryId}`);
    this.name = 'HistoryEntryNotFoundError';
  }
}
