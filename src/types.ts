/**
 * PluginSettings는 ConfigPort에 정의되어 있다.
 * 이 파일은 Plugin 계층에서 사용하는 추가 타입을 정의한다.
 */

/** Inbox 처리 큐 항목 */
export interface InboxQueueItem {
  readonly path: string;
  readonly receivedAt: number;
  readonly retryCount: number;
}

/** 디바운스 타이머 관리 */
export interface DebounceState {
  readonly timers: Map<string, ReturnType<typeof setTimeout>>;
  readonly pendingPaths: Set<string>;
}
