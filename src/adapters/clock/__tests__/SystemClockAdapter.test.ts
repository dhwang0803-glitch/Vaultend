import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemClockAdapter } from '../SystemClockAdapter';

describe('SystemClockAdapter', () => {
  let adapter: SystemClockAdapter;

  beforeEach(() => {
    adapter = new SystemClockAdapter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('now()는 현재 시간을 Timestamp로 반환한다', () => {
    vi.setSystemTime(new Date('2026-07-06T10:00:00Z'));
    const ts = adapter.now();
    expect(ts as number).toBe(new Date('2026-07-06T10:00:00Z').getTime());
  });

  it('연속 호출 시 시간 경과를 반영한다', () => {
    vi.setSystemTime(1000);
    const first = adapter.now();
    vi.advanceTimersByTime(5000);
    const second = adapter.now();
    expect((second as number) - (first as number)).toBe(5000);
  });

  it('양수 타임스탬프를 반환한다', () => {
    vi.setSystemTime(Date.now());
    const ts = adapter.now() as number;
    expect(ts).toBeGreaterThan(0);
  });
});
