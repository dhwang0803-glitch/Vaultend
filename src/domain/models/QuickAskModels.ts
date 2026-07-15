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
  readonly autoLink: boolean;
}

/**
 * QuickAskResult — AI 응답과 저장 결과.
 */
export interface QuickAskResult {
  readonly question: string;
  readonly answer: string;
  readonly contextChunksUsed: ReadonlyArray<NoteChunk>;
  readonly referencedNotes: ReadonlyArray<NotePath>;
  readonly savedTo: NotePath;
  readonly suggestedTags: ReadonlyArray<TagName>;
  readonly suggestedLinks: ReadonlyArray<NotePath>;
  readonly tokenUsage: TokenUsage;
  readonly timestamp: Timestamp;
  readonly truncated: boolean;
}

/**
 * ChatMessage — 채팅 한 턴의 메시지.
 */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly timestamp: Timestamp;
  readonly tokenUsage?: TokenUsage;
}

/**
 * ChatSession — 멀티턴 Quick Ask 대화 세션.
 */
export interface ChatSession {
  readonly id: string;
  readonly messages: ChatMessage[];
  readonly referencedNotes: NotePath[];
  readonly totalTokenUsage: TokenUsage;
  readonly createdAt: Timestamp;
  readonly systemPrompt: string;
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
