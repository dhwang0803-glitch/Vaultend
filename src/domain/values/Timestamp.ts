/** Unix 밀리초 타임스탬프 */
export type Timestamp = number & { readonly __brand: unique symbol };

export function createTimestamp(ms: number): Timestamp {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error('Timestamp는 0 이상의 유한한 숫자여야 합니다');
  }
  return ms as Timestamp;
}

export function timestampNow(): Timestamp {
  return Date.now() as Timestamp;
}
