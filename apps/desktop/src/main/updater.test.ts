import type { UpdateState } from '@cashfold/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdaterService, OFFLINE_TIMEOUT_MS, CHECK_INTERVAL_MS, LAUNCH_CHECK_DELAY_MS, type UpdaterLike, type UpdaterServiceOptions } from './updater';

// The consent-based update flow (FR-013 to FR-017, FR-031; contract B-2, B-3, B-4, B-8, B-9). The updater library is replaced by a fake, so
// every state, every refusal and every timer can be exercised exactly.

const SOURCE = 'https://github.com/cashfold/cashfold';
const FILE = 'Cashfold-1.3.0-linux-x64.AppImage';
const available = {
  isUpdateAvailable: true,
  updateInfo: { version: '1.3.0', files: [{ url: FILE, sha512: 'c2hh', size: 10 }] },
};

function fakeUpdater(overrides: Partial<UpdaterLike> = {}) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const updater: UpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: true,
    checkForUpdates: vi.fn(async () => available),
    downloadUpdate: vi.fn(async () => [`/cache/${FILE}`]),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return updater;
    }),
    ...overrides,
  };
  return { updater, emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args) };
}

function setup(options: { mode?: 'in-app' | 'manual'; autoCheck?: boolean; updater?: Partial<UpdaterLike>; verify?: boolean } = {}) {
  const fake = fakeUpdater(options.updater);
  const states: UpdateState[] = [];
  let autoCheck = options.autoCheck ?? true;
  const store = { get: () => ({ autoCheck }), update: vi.fn((change: { autoCheck?: boolean; lastCheckedAt?: string }) => void (change.autoCheck !== undefined && (autoCheck = change.autoCheck))) };
  const deps: UpdaterServiceOptions = {
    updater: fake.updater,
    mode: options.mode ?? 'in-app',
    currentVersion: '1.2.0',
    store,
    verify: vi.fn(async () => options.verify ?? true),
    remove: vi.fn(async () => undefined),
    emit: (state) => states.push(state),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    releaseBase: `${SOURCE}/releases`,
    pinnedDownloadBase: `${SOURCE}/releases/download`,
  };
  const service = createUpdaterService(deps);
  return { service, deps, states, store, ...fake };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('how the updater library is set up', () => {
  it('never downloads or installs by itself, and never goes back or to a pre-release', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
  });

  it('starts idle', () => {
    expect(setup().service.state()).toEqual({ kind: 'idle' });
  });
});

describe('checking', () => {
  it('says so when there is nothing newer', async () => {
    const { service, states, store } = setup({ updater: { checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: false, updateInfo: { version: '1.2.0', files: [] } })) } });
    await expect(service.check()).resolves.toEqual({ kind: 'none' });
    expect(states.map((s) => s.kind)).toEqual(['checking', 'none']);
    expect(store.update).toHaveBeenCalledWith({ lastCheckedAt: '2026-10-22T10:00:00.000Z' });
  });

  it('says so when the updater has nothing to say (an unpackaged run)', async () => {
    const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => null) } });
    await expect(service.check()).resolves.toEqual({ kind: 'none' });
  });

  it('offers a newer version with its release notes, and does nothing else', async () => {
    const { service, updater } = setup();
    await expect(service.check()).resolves.toEqual({ kind: 'available', version: '1.3.0', notesUrl: `${SOURCE}/releases/tag/v1.3.0`, mode: 'in-app' });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(service.state().kind).toBe('available');
  });

  it('marks the offer as manual for a copy that cannot update itself', async () => {
    const { service } = setup({ mode: 'manual' });
    await expect(service.check()).resolves.toMatchObject({ kind: 'available', mode: 'manual' });
  });

  it('asks the library once when asked twice at the same time', async () => {
    const { service, updater } = setup();
    await Promise.all([service.check(), service.check()]);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('when the network is not there', () => {
  it.each(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNRESET'])('%s ends in the offline state, quietly', async (code) => {
    const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => { throw Object.assign(new Error('request failed'), { code }); }) } });
    await expect(service.check()).resolves.toEqual({ kind: 'error', code: 'offline' });
  });

  it('knows the browser engine\'s way of saying it', async () => {
    const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); }) } });
    await expect(service.check()).resolves.toEqual({ kind: 'error', code: 'offline' });
  });

  it('gives up on a check that never answers, within the timeout, and does not throw', async () => {
    const { service } = setup({ updater: { checkForUpdates: vi.fn(() => new Promise<never>(() => undefined)) } });
    const result = service.check();
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS + 1);
    await expect(result).resolves.toEqual({ kind: 'error', code: 'offline' });
  });

  it('is usable again afterwards', async () => {
    const check = vi.fn<UpdaterLike['checkForUpdates']>().mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).mockResolvedValue(available);
    const { service } = setup({ updater: { checkForUpdates: check } });
    await service.check();
    await expect(service.check()).resolves.toMatchObject({ kind: 'available' });
  });

  it('reports any other failure as unknown', async () => {
    const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => { throw new Error('something odd'); }) } });
    await expect(service.check()).resolves.toEqual({ kind: 'error', code: 'unknown' });
  });
});

describe('downloading: only after the person agrees', () => {
  it('is refused when nothing was offered', async () => {
    const { service, updater } = setup();
    await expect(service.download()).rejects.toThrow();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('is refused for a copy that cannot update itself (B-2)', async () => {
    const { service, updater } = setup({ mode: 'manual' });
    await service.check();
    await expect(service.download()).rejects.toThrow();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.state().kind).toBe('available');
  });

  it('shows the progress, checks the signature of the file that arrived, and only then says it is ready', async () => {
    const { service, states, updater, emit, deps } = setup({
      updater: {
        downloadUpdate: vi.fn(async () => {
          emit('download-progress', { percent: 41.6 });
          return [`/cache/${FILE}`];
        }),
      },
    });
    await service.check();
    const result = await service.download();
    expect(result).toEqual({ kind: 'ready', version: '1.3.0' });
    expect(states.map((s) => s.kind)).toEqual(['checking', 'available', 'downloading', 'downloading', 'ready']);
    expect(states.filter((s) => s.kind === 'downloading')).toEqual([{ kind: 'downloading', version: '1.3.0', percent: 0 }, { kind: 'downloading', version: '1.3.0', percent: 41 }]);
    expect(deps.verify).toHaveBeenCalledWith(`/cache/${FILE}`, '1.3.0');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('never shows more than 100, or less than 0, whatever the library reports', async () => {
    const { service, states, emit } = setup({ updater: { downloadUpdate: vi.fn(async () => { emit('download-progress', { percent: 250 }); emit('download-progress', { percent: -3 }); emit('download-progress', { percent: Number.NaN }); return [`/cache/${FILE}`]; }) } });
    await service.check();
    await service.download();
    for (const s of states) {
      if (s.kind !== 'downloading') continue;
      expect(s.percent).toBeGreaterThanOrEqual(0);
      expect(s.percent).toBeLessThanOrEqual(100);
    }
  });

  it('refuses a file whose signature does not check: the file is deleted and nothing can be installed (B-9)', async () => {
    const { service, deps, updater } = setup({ verify: false });
    await service.check();
    await expect(service.download()).resolves.toEqual({ kind: 'error', code: 'verify-failed' });
    expect(deps.remove).toHaveBeenCalledWith(`/cache/${FILE}`);
    await expect(service.install()).rejects.toThrow();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('removes every file the library delivered when the signature is bad', async () => {
    const { service, deps } = setup({ verify: false, updater: { downloadUpdate: vi.fn(async () => ['/cache/a.exe', '/cache/a.exe.blockmap']) } });
    await service.check();
    await service.download();
    expect(deps.remove).toHaveBeenCalledWith('/cache/a.exe');
    expect(deps.remove).toHaveBeenCalledWith('/cache/a.exe.blockmap');
  });

  it('treats a verification that throws as a failed verification', async () => {
    const { service, deps } = setup();
    (deps.verify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await service.check();
    await expect(service.download()).resolves.toEqual({ kind: 'error', code: 'verify-failed' });
  });

  it('maps a checksum mismatch to verify-failed and other failures to download-failed', async () => {
    const mismatch = setup({ updater: { downloadUpdate: vi.fn(async () => { throw new Error('sha512 checksum mismatch, expected abc, got def'); }) } });
    await mismatch.service.check();
    await expect(mismatch.service.download()).resolves.toEqual({ kind: 'error', code: 'verify-failed' });
    const broken = setup({ updater: { downloadUpdate: vi.fn(async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); }) } });
    await broken.service.check();
    await expect(broken.service.download()).resolves.toEqual({ kind: 'error', code: 'download-failed' });
  });

  it('can check again after a failed download', async () => {
    const { service } = setup({ verify: false });
    await service.check();
    await service.download();
    await expect(service.check()).resolves.toMatchObject({ kind: 'available' });
  });

  it('refuses a second download while one is running', async () => {
    let finish: (files: string[]) => void = () => undefined;
    const { service, updater } = setup({ updater: { downloadUpdate: vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve))) } });
    await service.check();
    const first = service.download();
    await expect(service.download()).rejects.toThrow();
    finish([`/cache/${FILE}`]);
    await first;
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('installing: only what was downloaded and verified, and only when asked (B-3)', () => {
  it('is refused before anything was downloaded', async () => {
    const { service, updater } = setup();
    await expect(service.install()).rejects.toThrow();
    await service.check();
    await expect(service.install()).rejects.toThrow();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('quits and installs once, after a verified download and a call', async () => {
    const { service, updater } = setup();
    await service.check();
    await service.download();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('where updates may come from', () => {
  it('refuses an offer that points a download at another host', async () => {
    const hostile = { isUpdateAvailable: true, updateInfo: { version: '1.3.0', files: [{ url: 'https://evil.example/Cashfold.AppImage', sha512: 'c2hh', size: 1 }] } };
    const { service, updater } = setup({ updater: { checkForUpdates: vi.fn(async () => hostile) } });
    await expect(service.check()).resolves.toEqual({ kind: 'error', code: 'verify-failed' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('accepts an absolute address inside the pinned release downloads, and plain file names', async () => {
    const inside = { isUpdateAvailable: true, updateInfo: { version: '1.3.0', files: [{ url: `${SOURCE}/releases/download/v1.3.0/${FILE}`, sha512: 'c2hh', size: 1 }] } };
    const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => inside) } });
    await expect(service.check()).resolves.toMatchObject({ kind: 'available' });
  });

  it('refuses a path that climbs out of the pinned release', async () => {
    const climbing = { isUpdateAvailable: true, updateInfo: { version: '1.3.0', files: [{ url: `${SOURCE}/releases/download/../../../evil/x.exe`, sha512: 'c2hh', size: 1 }] } };
    const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => climbing) } });
    await expect(service.check()).resolves.toEqual({ kind: 'error', code: 'verify-failed' });
  });

  it('refuses an offer with no version or a version that is not one', async () => {
    for (const version of ['', 'latest', '1.3', '../1.3.0']) {
      const odd = { isUpdateAvailable: true, updateInfo: { version, files: [{ url: FILE, sha512: 'c2hh', size: 1 }] } };
      const { service } = setup({ updater: { checkForUpdates: vi.fn(async () => odd) } });
      await expect(service.check(), version).resolves.toEqual({ kind: 'error', code: 'unknown' });
    }
  });
});

describe('checking by itself (B-8, FR-031)', () => {
  it('checks soon after start and then every few hours, and tells the person only when something is found', async () => {
    const { service, updater, states } = setup();
    service.start();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LAUNCH_CHECK_DELAY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.kind).toBe('available');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not disturb a download in progress or an update that is ready to install', async () => {
    const { service, updater } = setup();
    await service.check();
    await service.download();
    expect(service.state().kind).toBe('ready');
    service.start();
    await vi.advanceTimersByTimeAsync(LAUNCH_CHECK_DELAY_MS + CHECK_INTERVAL_MS * 3);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(service.state().kind).toBe('ready');
  });

  it('stops when the app stops', async () => {
    const { service, updater } = setup();
    service.start();
    service.stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('makes no request at all when the person has switched checking off, but a manual check still works', async () => {
    const { service, updater } = setup({ autoCheck: false });
    service.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await expect(service.check()).resolves.toMatchObject({ kind: 'available' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('follows the switch: off stops the schedule, on starts it', async () => {
    const { service, updater, store } = setup();
    service.start();
    expect(service.autoCheck()).toBe(true);
    expect(service.setAutoCheck(false)).toBe(false);
    expect(store.update).toHaveBeenCalledWith({ autoCheck: false });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(service.setAutoCheck(true)).toBe(true);
    await vi.advanceTimersByTimeAsync(LAUNCH_CHECK_DELAY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('checks again later if the person switched it off just before a check was due', async () => {
    const { service, updater, store } = setup();
    service.start();
    store.update({ autoCheck: false });
    await vi.advanceTimersByTimeAsync(LAUNCH_CHECK_DELAY_MS);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    service.stop();
  });
});

describe('the release page', () => {
  it('is the page of the offered version, or the list of releases when nothing is offered', async () => {
    const { service } = setup();
    expect(service.releasePageUrl()).toBe(`${SOURCE}/releases`);
    await service.check();
    expect(service.releasePageUrl()).toBe(`${SOURCE}/releases/tag/v1.3.0`);
  });
});
