import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileChangeTrackingAdapter } from '../FileChangeTrackingAdapter';
import { createNotePath } from '../../../domain/values/NotePath';
import { DIRTY_SET_PATH } from '../../../constants';

describe('FileChangeTrackingAdapter', () => {
  let adapter: FileChangeTrackingAdapter;
  let mockVault: { readFileRaw: ReturnType<typeof vi.fn>; writeFileRaw: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockVault = {
      readFileRaw: vi.fn().mockResolvedValue(null),
      writeFileRaw: vi.fn().mockResolvedValue(undefined),
    };
    adapter = new FileChangeTrackingAdapter(mockVault as never);
  });

  it('starts with an empty dirty set', async () => {
    const dirty = await adapter.getDirtySet();
    expect(dirty.size).toBe(0);
  });

  it('marks a path as dirty', async () => {
    const path = createNotePath('notes/test.md');
    await adapter.markDirty(path);
    const dirty = await adapter.getDirtySet();
    expect(dirty.has(path)).toBe(true);
  });

  it('marks a path as clean', async () => {
    const path = createNotePath('notes/test.md');
    await adapter.markDirty(path);
    await adapter.markClean(path);
    const dirty = await adapter.getDirtySet();
    expect(dirty.has(path)).toBe(false);
  });

  it('clears all dirty paths', async () => {
    await adapter.markDirty(createNotePath('a.md'));
    await adapter.markDirty(createNotePath('b.md'));
    await adapter.clearAll();
    const dirty = await adapter.getDirtySet();
    expect(dirty.size).toBe(0);
  });

  it('persists dirty set to vault', async () => {
    await adapter.markDirty(createNotePath('notes/test.md'));
    await adapter.persist();
    expect(mockVault.writeFileRaw).toHaveBeenCalledWith(
      DIRTY_SET_PATH,
      expect.stringContaining('notes/test.md'),
    );
  });

  it('loads persisted dirty set on first access', async () => {
    mockVault.readFileRaw.mockResolvedValue(JSON.stringify({
      dirtyPaths: ['notes/a.md', 'notes/b.md'],
      lastScanTimestamp: 1234567890,
    }));

    const freshAdapter = new FileChangeTrackingAdapter(mockVault as never);
    const dirty = await freshAdapter.getDirtySet();
    expect(dirty.size).toBe(2);
    expect(await freshAdapter.getLastScanTimestamp()).toBe(1234567890);
  });

  it('handles corrupted JSON gracefully', async () => {
    mockVault.readFileRaw.mockResolvedValue('not valid json{{{');
    const freshAdapter = new FileChangeTrackingAdapter(mockVault as never);
    const dirty = await freshAdapter.getDirtySet();
    expect(dirty.size).toBe(0);
  });

  it('sets and gets last scan timestamp', async () => {
    await adapter.setLastScanTimestamp(999);
    expect(await adapter.getLastScanTimestamp()).toBe(999);
  });
});
