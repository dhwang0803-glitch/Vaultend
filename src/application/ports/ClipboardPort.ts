/**
 * 클립보드 포트 — 시스템 클립보드 접근을 추상화한다.
 */
export interface ClipboardPort {
  /** 클립보드의 텍스트 내용을 읽는다. 비어 있으면 null. */
  read(): Promise<string | null>;
}
