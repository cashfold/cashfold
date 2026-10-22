import type { UpdateState } from '@cashfold/platform';
import { describe, expect, it, vi } from 'vitest';
import { describeUpdate, restartAndUpdate } from './update-view';

// What the person is shown for each state of the update flow (FR-014, FR-015): never an action that would do something they did not ask for,
// and for a copy that cannot update itself, how to update by hand.

const available: UpdateState = { kind: 'available', version: '1.3.0', notesUrl: 'https://github.com/cashfold/cashfold/releases/tag/v1.3.0', mode: 'in-app' };

describe('what is shown for each state', () => {
  it('offers only a check when nothing is known, and says it is current after a check that found nothing', () => {
    expect(describeUpdate({ kind: 'idle' }, 'appimage')).toEqual({ messageKey: 'settings.update.idle', params: {}, actions: ['check'] });
    expect(describeUpdate({ kind: 'none' }, 'appimage')).toEqual({ messageKey: 'settings.update.none', params: {}, actions: ['check'] });
  });

  it('offers nothing while it is looking', () => {
    expect(describeUpdate({ kind: 'checking' }, 'nsis')).toEqual({ messageKey: 'settings.update.checking', params: {}, actions: [] });
  });

  it('offers to download a new version that this copy can install itself, and to read what is new', () => {
    expect(describeUpdate(available, 'nsis')).toEqual({ messageKey: 'settings.update.available', params: { version: '1.3.0' }, actions: ['download', 'notes'] });
  });

  it('for a copy updated by hand, says how, and offers the release page, never a download', () => {
    const manual: UpdateState = { ...available, mode: 'manual' };
    expect(describeUpdate(manual, 'deb')).toEqual({ messageKey: 'settings.update.manual.deb', params: { version: '1.3.0' }, actions: ['releasePage'] });
    expect(describeUpdate(manual, 'rpm')).toEqual({ messageKey: 'settings.update.manual.rpm', params: { version: '1.3.0' }, actions: ['releasePage'] });
    expect(describeUpdate(manual, 'dmg')).toEqual({ messageKey: 'settings.update.manual.dmg', params: { version: '1.3.0' }, actions: ['releasePage'] });
    expect(describeUpdate(manual, 'unpacked')).toEqual({ messageKey: 'settings.update.manual.other', params: { version: '1.3.0' }, actions: ['releasePage'] });
    for (const packaging of ['deb', 'rpm', 'dmg', 'unpacked', 'nsis', 'appimage'] as const) expect(describeUpdate(manual, packaging).actions).not.toContain('download');
  });

  it('shows progress while downloading, with nothing to press', () => {
    expect(describeUpdate({ kind: 'downloading', version: '1.3.0', percent: 40 }, 'nsis')).toEqual({ messageKey: 'settings.update.downloading', params: { version: '1.3.0', percent: 40 }, actions: [] });
  });

  it('offers the restart only once the update is ready', () => {
    expect(describeUpdate({ kind: 'ready', version: '1.3.0' }, 'nsis')).toEqual({ messageKey: 'settings.update.ready', params: { version: '1.3.0' }, actions: ['install'] });
  });

  it('explains each failure in its own words and offers another try', () => {
    const keys = (['offline', 'verify-failed', 'download-failed', 'unknown'] as const).map((code) => describeUpdate({ kind: 'error', code }, 'nsis'));
    expect(keys.map((k) => k.messageKey)).toEqual(['settings.update.error.offline', 'settings.update.error.verify-failed', 'settings.update.error.download-failed', 'settings.update.error.unknown']);
    for (const k of keys) expect(k.actions).toEqual(['check']);
  });
});

describe('restart and update', () => {
  it('locks first, waits for the session to finish locking, and only then installs', async () => {
    const order: string[] = [];
    let finishLocking: () => void = () => undefined;
    await restartAndUpdate({
      lock: () => {
        order.push('lock');
        finishLocking();
      },
      // The waiter is obtained before locking, so a lock that finishes at once cannot be missed.
      locked: () =>
        new Promise<void>((resolve) => {
          finishLocking = () => {
            order.push('locked');
            resolve();
          };
        }),
      install: async () => void order.push('install'),
    });
    expect(order).toEqual(['lock', 'locked', 'install']);
  });

  it('does not wait forever for the lock: it installs after a short while anyway', async () => {
    vi.useFakeTimers();
    const install = vi.fn(async () => undefined);
    const done = restartAndUpdate({ lock: () => undefined, locked: () => new Promise<void>(() => undefined), install, lockTimeoutMs: 3_000 });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await done;
    expect(install).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not install when locking itself fails, so work in progress is never cut off by an update', async () => {
    const install = vi.fn(async () => undefined);
    await expect(restartAndUpdate({ lock: () => { throw new Error('busy'); }, locked: async () => undefined, install })).rejects.toThrow('busy');
    expect(install).not.toHaveBeenCalled();
  });
});
