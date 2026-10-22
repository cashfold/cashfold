import type { UpdateState } from '@cashfold/platform';
import type { Logger } from './log';

// The update flow, as a state machine that moves only when the person asks (specs/003 data-model "Update", contract B-2, B-3, B-8, B-9):
//
//   idle ──check──▶ checking ──▶ none | available(v) | error
//   available ──download (in-app only)──▶ downloading(%) ──▶ ready(v) | error      (ready only after the project's signature checked out)
//   ready ──install──▶ the app quits and the installer runs
//
// Nothing downloads or installs by itself, a check never blocks anything, an offline machine is a quiet state, not an error dialog, and a
// download whose signature does not check is deleted. The updater library is behind a small interface so every path can be tested.

export const OFFLINE_TIMEOUT_MS = 20_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const LAUNCH_CHECK_DELAY_MS = 10_000;

export interface UpdateFileLike {
  readonly url: string;
  readonly sha512?: string;
  readonly size?: number;
}

export interface CheckResultLike {
  readonly isUpdateAvailable?: boolean;
  readonly updateInfo: { readonly version: string; readonly files: readonly UpdateFileLike[] };
}

/** The part of electron-updater's `AppUpdater` that the flow uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<CheckResultLike | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface UpdaterServiceOptions {
  readonly updater: UpdaterLike;
  readonly mode: 'in-app' | 'manual';
  readonly currentVersion: string;
  readonly store: { get(): { readonly autoCheck: boolean }; update(change: { autoCheck?: boolean; lastCheckedAt?: string }): void };
  /** Checks the project's signature on a downloaded file (update-verify.ts). */
  readonly verify: (file: string, version: string) => Promise<boolean>;
  readonly remove: (file: string) => Promise<void>;
  readonly emit: (state: UpdateState) => void;
  readonly log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>;
  readonly now?: () => Date;
  /** The releases page of the project; the page of one release is `<releaseBase>/tag/v<version>`. */
  readonly releaseBase: string;
  /** Downloads may be addressed absolutely only inside this prefix (`…/releases/download`). */
  readonly pinnedDownloadBase: string;
}

export interface UpdaterService {
  state(): UpdateState;
  check(): Promise<UpdateState>;
  /** Only valid in `available`, in the in-app mode. Throws otherwise. */
  download(): Promise<UpdateState>;
  /** Only valid in `ready`. Throws otherwise. */
  install(): Promise<void>;
  releasePageUrl(): string;
  autoCheck(): boolean;
  setAutoCheck(on: boolean): boolean;
  /** Starts the automatic checks (if switched on). */
  start(): void;
  stop(): void;
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETDOWN']);
const NETWORK_MESSAGE = /net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_\w+|NETWORK_\w+|TIMED_OUT|PROXY_CONNECTION_FAILED)/;

class Timeout extends Error {}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Timeout('timed out')), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Timeout) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) return true;
  return NETWORK_MESSAGE.test(error instanceof Error ? error.message : '');
}

function failure(error: unknown, phase: 'check' | 'download'): UpdateState {
  if (/checksum|sha512|sha-512/i.test(error instanceof Error ? error.message : '')) return { kind: 'error', code: 'verify-failed' };
  if (phase === 'check') return { kind: 'error', code: isNetworkFailure(error) ? 'offline' : 'unknown' };
  return { kind: 'error', code: 'download-failed' };
}

export function createUpdaterService(options: UpdaterServiceOptions): UpdaterService {
  const { updater, store, log } = options;
  const now = options.now ?? (() => new Date());
  // The library never acts on its own: every step is the person's call, and it never goes back or to a pre-release.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;

  let current: UpdateState = { kind: 'idle' };
  let offered: { version: string } | undefined;
  let running: Promise<UpdateState> | undefined;
  let started = false;
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  const set = (state: UpdateState): UpdateState => {
    current = state;
    options.emit(state);
    return state;
  };

  updater.on('download-progress', (progress: { percent?: unknown }) => {
    if (current.kind !== 'downloading' || typeof progress.percent !== 'number' || !Number.isFinite(progress.percent)) return;
    const percent = Math.min(100, Math.max(0, Math.floor(progress.percent)));
    if (percent !== current.percent) set({ kind: 'downloading', version: current.version, percent });
  });

  /** A download address may only be a plain file name, or an address inside this project's release downloads. */
  const pinned = (files: readonly UpdateFileLike[]): boolean =>
    files.every((file) => {
      if (!URL.canParse(file.url)) return !file.url.includes('/') && !file.url.includes('\\') && file.url !== '..';
      return new URL(file.url).href.startsWith(`${options.pinnedDownloadBase}/`);
    });

  async function doCheck(): Promise<UpdateState> {
    set({ kind: 'checking' });
    try {
      const result = await withTimeout(updater.checkForUpdates(), OFFLINE_TIMEOUT_MS);
      store.update({ lastCheckedAt: now().toISOString() });
      if (result === null || result.isUpdateAvailable !== true) {
        offered = undefined;
        return set({ kind: 'none' });
      }
      const { version, files } = result.updateInfo;
      if (typeof version !== 'string' || !VERSION.test(version)) {
        log.warn('update.bad-version');
        return set({ kind: 'error', code: 'unknown' });
      }
      if (!pinned(files)) {
        log.warn('update.unpinned-download');
        return set({ kind: 'error', code: 'verify-failed' });
      }
      offered = { version };
      log.info('update.available', { version });
      return set({ kind: 'available', version, notesUrl: `${options.releaseBase}/tag/v${version}`, mode: options.mode });
    } catch (error) {
      const state = failure(error, 'check');
      log.info('update.check-failed', { reason: state.kind === 'error' ? state.code : 'unknown', error });
      return set(state);
    }
  }

  function check(): Promise<UpdateState> {
    if (running !== undefined) return running;
    // A download in progress or a verified update waiting for the person is not disturbed by another look.
    if (current.kind === 'downloading' || current.kind === 'ready') return Promise.resolve(current);
    running = doCheck().finally(() => {
      running = undefined;
    });
    return running;
  }

  async function download(): Promise<UpdateState> {
    if (current.kind !== 'available' || options.mode !== 'in-app') throw new Error('nothing to download');
    const { version } = current;
    set({ kind: 'downloading', version, percent: 0 });
    try {
      const files = await updater.downloadUpdate();
      const installer = files.find((f) => !f.endsWith('.blockmap')) ?? files[0];
      const genuine = installer !== undefined && (await options.verify(installer, version).catch(() => false));
      if (!genuine) {
        // Delete what arrived: an update that cannot be shown to come from the project is never installed.
        await Promise.all(files.map((file) => options.remove(file).catch(() => undefined)));
        log.warn('update.verify-failed', { version });
        return set({ kind: 'error', code: 'verify-failed' });
      }
      log.info('update.ready', { version });
      return set({ kind: 'ready', version });
    } catch (error) {
      const state = failure(error, 'download');
      log.warn('update.download-failed', { reason: state.kind === 'error' ? state.code : 'unknown', error });
      return set(state);
    }
  }

  async function install(): Promise<void> {
    if (current.kind !== 'ready') throw new Error('nothing is ready to install');
    log.info('update.install', { version: current.version });
    updater.quitAndInstall(false, true);
  }

  const tick = (): void => {
    if (!store.get().autoCheck) return;
    if (current.kind === 'downloading' || current.kind === 'ready' || current.kind === 'checking') return;
    void check();
  };

  function schedule(): void {
    if (!started || !store.get().autoCheck || launchTimer !== undefined) return;
    launchTimer = setTimeout(tick, LAUNCH_CHECK_DELAY_MS);
    interval = setInterval(tick, CHECK_INTERVAL_MS);
    launchTimer.unref?.();
    interval.unref?.();
  }

  function unschedule(): void {
    if (launchTimer !== undefined) clearTimeout(launchTimer);
    if (interval !== undefined) clearInterval(interval);
    launchTimer = undefined;
    interval = undefined;
  }

  return {
    state: () => current,
    check,
    download,
    install,
    releasePageUrl: () => (offered === undefined ? options.releaseBase : `${options.releaseBase}/tag/v${offered.version}`),
    autoCheck: () => store.get().autoCheck,
    setAutoCheck(on) {
      store.update({ autoCheck: on });
      if (on) schedule();
      else unschedule();
      return on;
    },
    start() {
      started = true;
      schedule();
    },
    stop() {
      started = false;
      unschedule();
    },
  };
}
