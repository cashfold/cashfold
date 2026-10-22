import type { AboutInfo, UpdateState } from '@cashfold/platform';

// What the interface says and offers for each state of the desktop update flow. A pure function, so that it can be tested without a window:
// the point is that an action is offered only when it is the person's next choice, and never one that would act on its own (FR-014, FR-015).

export type UpdateAction = 'check' | 'download' | 'notes' | 'install' | 'releasePage';

export interface UpdateView {
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly actions: readonly UpdateAction[];
}

const MANUAL_KEYS: Readonly<Record<AboutInfo['packaging'], string>> = {
  deb: 'settings.update.manual.deb',
  rpm: 'settings.update.manual.rpm',
  dmg: 'settings.update.manual.dmg',
  nsis: 'settings.update.manual.other',
  appimage: 'settings.update.manual.other',
  unpacked: 'settings.update.manual.other',
};

export function describeUpdate(state: UpdateState, packaging: AboutInfo['packaging']): UpdateView {
  switch (state.kind) {
    case 'idle':
      return { messageKey: 'settings.update.idle', params: {}, actions: ['check'] };
    case 'none':
      return { messageKey: 'settings.update.none', params: {}, actions: ['check'] };
    case 'checking':
      return { messageKey: 'settings.update.checking', params: {}, actions: [] };
    case 'available':
      return state.mode === 'in-app'
        ? { messageKey: 'settings.update.available', params: { version: state.version }, actions: ['download', 'notes'] }
        : { messageKey: MANUAL_KEYS[packaging], params: { version: state.version }, actions: ['releasePage'] };
    case 'downloading':
      return { messageKey: 'settings.update.downloading', params: { version: state.version, percent: state.percent }, actions: [] };
    case 'ready':
      return { messageKey: 'settings.update.ready', params: { version: state.version }, actions: ['install'] };
    case 'error':
      return { messageKey: `settings.update.error.${state.code}`, params: {}, actions: ['check'] };
  }
}

export interface RestartSteps {
  /** Locks the app: ends the session and lets the worker finish what it was doing. */
  lock(): void;
  /** Resolves when the lock has finished. */
  locked(): Promise<void>;
  install(): Promise<void>;
  lockTimeoutMs?: number;
}

/**
 * "Restart and update": first lock the app and wait until the session has let go of the database, so that an update never meets a write in
 * progress (FR-017; SQLite's atomic commit is the safety net), then hand over to the shell. If locking fails, nothing is installed.
 */
export async function restartAndUpdate(steps: RestartSteps): Promise<void> {
  const waiting = steps.locked();
  steps.lock();
  await Promise.race([waiting, new Promise<void>((resolve) => setTimeout(resolve, steps.lockTimeoutMs ?? 5_000))]);
  await steps.install();
}
