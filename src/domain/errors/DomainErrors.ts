/**
 * 도메인 계층의 에러 타입 — 외부 의존성과 무관한 비즈니스 규칙 위반.
 */
export class NoteNotFoundError extends Error {
  constructor(readonly identifier: string) {
    super(`노트를 찾을 수 없습니다: ${identifier}`);
    this.name = 'NoteNotFoundError';
  }
}

export class DuplicateNoteError extends Error {
  constructor(readonly path: string) {
    super(`이미 존재하는 노트입니다: ${path}`);
    this.name = 'DuplicateNoteError';
  }
}

export class InvalidNoteContentError extends Error {
  constructor(readonly reason: string) {
    super(`유효하지 않은 노트 내용: ${reason}`);
    this.name = 'InvalidNoteContentError';
  }
}

export class AIProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly statusCode: number,
    readonly detail: string,
  ) {
    super(`AI 공급자 오류 [${provider}] (${statusCode}): ${detail}`);
    this.name = 'AIProviderError';
  }
}

export class PrivacyViolationError extends Error {
  constructor(readonly ruleName: string) {
    super(`프라이버시 규칙 위반: ${ruleName}`);
    this.name = 'PrivacyViolationError';
  }
}

export class AIParseError extends AIProviderError {
  constructor(provider: string, rawContent: string) {
    super(provider, 0, `JSON 파싱 실패 (재시도 후에도 실패). 원본: ${rawContent.slice(0, 200)}`);
    this.name = 'AIParseError';
  }
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`요청 한도 초과 — ${retryAfterMs}ms 후 재시도`);
    this.name = 'RateLimitError';
  }
}

export class HistoryEntryNotFoundError extends Error {
  constructor(readonly entryId: string) {
    super(`되돌릴 이력 항목을 찾을 수 없습니다: ${entryId}`);
    this.name = 'HistoryEntryNotFoundError';
  }
}
