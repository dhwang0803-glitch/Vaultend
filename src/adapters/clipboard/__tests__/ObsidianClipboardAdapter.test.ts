import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObsidianClipboardAdapter } from '../ObsidianClipboardAdapter';

describe('ObsidianClipboardAdapter', () => {
  let adapter: ObsidianClipboardAdapter;
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    adapter = new ObsidianClipboardAdapter();
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          readText: vi.fn(),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('클립보드에 텍스트가 있으면 문자열을 반환한다', async () => {
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('Hello World');
    const result = await adapter.read();
    expect(result).toBe('Hello World');
  });

  it('클립보드가 빈 문자열이면 null을 반환한다', async () => {
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('');
    const result = await adapter.read();
    expect(result).toBeNull();
  });

  it('클립보드가 공백만이면 null을 반환한다', async () => {
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('   \n  ');
    const result = await adapter.read();
    expect(result).toBeNull();
  });

  it('클립보드 접근 에러 시 null을 반환한다', async () => {
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('Permission denied'));
    const result = await adapter.read();
    expect(result).toBeNull();
  });
});
