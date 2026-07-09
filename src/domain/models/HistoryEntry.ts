import { NotePath } from '../values/NotePath';
import { Timestamp } from '../values/Timestamp';

/**
 * HistoryEntry — 플러그인이 수행한 하나의 변경 작업을 기록한다.
 */
export interface HistoryEntry {
  readonly id: string;
  readonly action: HistoryAction;
  readonly notePath: NotePath;
  readonly timestamp: Timestamp;
  readonly description: string;
  readonly previousContent?: string;  // 되돌리기(undo)를 위한 이전 내용
  readonly metadata?: Record<string, unknown>;
}

export type HistoryAction =
  | 'create'
  | 'modify'
  | 'tag-add'
  | 'tag-remove'
  | 'link-add'
  | 'link-remove'
  | 'move'
  | 'classify'
  | 'delete'
  | 'dismiss'
  | 'quick-ask-save'
  | 'clipboard-capture';
