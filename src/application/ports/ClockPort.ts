import { Timestamp } from '../../domain/values/Timestamp';

/**
 * 시계 포트 — 현재 시간 조회를 추상화한다.
 *
 * 테스트 시 시간을 고정하기 위해 포트로 분리한다.
 * 직접 Date.now()를 호출하면 테스트가 비결정적(non-deterministic)이 된다.
 */
export interface ClockPort {
  /** 현재 Unix 밀리초 타임스탬프 반환. */
  now(): Timestamp;
}
