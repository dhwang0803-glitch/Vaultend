import { describe, it, expect } from 'vitest';
import { createTimestamp, timestampNow } from '../Timestamp';

describe('createTimestamp', () => {
  it('양수 밀리초를 정상 생성한다', () => {
    const ts = createTimestamp(1720000000000);
    expect(ts as number).toBe(1720000000000);
  });

  it('0을 허용한다', () => {
    const ts = createTimestamp(0);
    expect(ts as number).toBe(0);
  });

  it('음수는 거부한다', () => {
    expect(() => createTimestamp(-1)).toThrow('0 이상');
  });

  it('NaN은 거부한다', () => {
    expect(() => createTimestamp(NaN)).toThrow('유한한');
  });

  it('Infinity는 거부한다', () => {
    expect(() => createTimestamp(Infinity)).toThrow('유한한');
  });

  it('-Infinity는 거부한다', () => {
    expect(() => createTimestamp(-Infinity)).toThrow('유한한');
  });
});

describe('timestampNow', () => {
  it('현재 시간에 가까운 값을 반환한다', () => {
    const before = Date.now();
    const ts = timestampNow();
    const after = Date.now();
    expect(ts as number).toBeGreaterThanOrEqual(before);
    expect(ts as number).toBeLessThanOrEqual(after);
  });
});
