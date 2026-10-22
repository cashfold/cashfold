import { describe, expect, it, vi } from 'vitest';
import { checkDataFolder, LOW_SPACE_BYTES, problemMessage, type DataFolderDeps } from './data-folder';

const MiB = 1024 * 1024;
const fine = (): DataFolderDeps => ({ mkdir: vi.fn(), probe: vi.fn(), freeBytes: vi.fn(() => 10_000 * MiB) });

describe('checking the data folder before the app uses it', () => {
  it('is fine when the folder can be created and written and there is room', () => {
    const deps = fine();
    expect(checkDataFolder('/data', deps)).toEqual({ kind: 'ok' });
    expect(deps.mkdir).toHaveBeenCalledWith('/data');
    expect(deps.probe).toHaveBeenCalledWith('/data');
  });

  it('is not writable when the folder cannot be created', () => {
    const deps = { ...fine(), mkdir: vi.fn(() => { throw new Error('EACCES'); }) };
    expect(checkDataFolder('/data', deps)).toEqual({ kind: 'not-writable' });
  });

  it('is not writable when a file cannot be written in it (read-only folder or volume)', () => {
    const deps = { ...fine(), probe: vi.fn(() => { throw new Error('EROFS'); }) };
    expect(checkDataFolder('/data', deps)).toEqual({ kind: 'not-writable' });
  });

  it('warns about low space, and says how much is left', () => {
    const deps = { ...fine(), freeBytes: vi.fn(() => LOW_SPACE_BYTES - 1) };
    expect(checkDataFolder('/data', deps)).toEqual({ kind: 'low-space', freeBytes: LOW_SPACE_BYTES - 1 });
  });

  it('does not warn at exactly the limit, or when the space cannot be read', () => {
    expect(checkDataFolder('/data', { ...fine(), freeBytes: () => LOW_SPACE_BYTES })).toEqual({ kind: 'ok' });
    expect(checkDataFolder('/data', { ...fine(), freeBytes: () => undefined })).toEqual({ kind: 'ok' });
  });

  it('prefers "not writable" over "low space"', () => {
    const deps = { mkdir: vi.fn(), probe: vi.fn(() => { throw new Error('EROFS'); }), freeBytes: vi.fn(() => 0) };
    expect(checkDataFolder('/data', deps)).toEqual({ kind: 'not-writable' });
  });

  it('keeps the limit small enough to be about a full disk, not a busy one', () => {
    expect(LOW_SPACE_BYTES).toBeGreaterThanOrEqual(20 * MiB);
    expect(LOW_SPACE_BYTES).toBeLessThanOrEqual(200 * MiB);
  });
});

describe('what the person is told', () => {
  it('names the folder when it cannot be written, and says nothing was changed', () => {
    const message = problemMessage({ kind: 'not-writable' }, '/home/x/.config/Cashfold');
    expect(message?.title).toMatch(/cannot/i);
    expect(message?.detail).toContain('/home/x/.config/Cashfold');
    expect(message?.detail).toMatch(/not been changed|unchanged|untouched/i);
  });

  it('has nothing to say when all is well, and nothing blocking for low space', () => {
    expect(problemMessage({ kind: 'ok' }, '/data')).toBeUndefined();
    expect(problemMessage({ kind: 'low-space', freeBytes: 1 }, '/data')).toBeUndefined();
  });
});
