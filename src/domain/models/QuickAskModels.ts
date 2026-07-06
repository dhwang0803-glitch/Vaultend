import { NoteChunk } from './NoteChunk';
import { SaveTarget } from './SaveTarget';
import { TagName } from '../values/TagName';
import { NotePath } from '../values/NotePath';
import { Timestamp } from '../values/Timestamp';

/**
 * QuickAskRequest — AI에게 보낼 질문과 옵션.
 */
export interface QuickAskRequest {
  readonly question: string;
  readonly maxContextChunks: number;
  readonly saveTarget: SaveTarget;
  readonly autoTag: boolean;
  readonly autoLink: boolean;
}

/**
 * QuickAskResult — AI 응답과 저장 결과.
 */
export interface QuickAskResult {
  readonly question: string;
  readonly answer: string;
  readonly contextChunksUsed: ReadonlyArray<NoteChunk>;
  readonly savedTo: NotePath;
  readonly suggestedTags: ReadonlyArray<TagName>;
  readonly suggestedLinks: ReadonlyArray<NotePath>;
  readonly tokenUsage: TokenUsage;
  readonly timestamp: Timestamp;
}

/**
 * TokenUsage — AI API 토큰 사용량 추적.
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
}
