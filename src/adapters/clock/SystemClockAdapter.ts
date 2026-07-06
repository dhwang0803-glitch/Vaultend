import { ClockPort } from '../../application/ports/ClockPort';
import { Timestamp, createTimestamp } from '../../domain/values/Timestamp';

/**
 * 시스템 시계 어댑터 — Date.now()를 래핑한다.
 */
export class SystemClockAdapter implements ClockPort {
  now(): Timestamp {
    return createTimestamp(Date.now());
  }
}
