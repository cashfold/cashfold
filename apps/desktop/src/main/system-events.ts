import type { SystemLockEvent } from '@cashfold/platform';

// The computer locking, sleeping or going idle is what locks the app (spec 006, US1), instead of a click on another window. The shell
// only reports the fact; the page, which owns the session, locks. Nothing here sees or holds data.

export interface PowerMonitorLike {
  on(event: 'lock-screen' | 'suspend' | 'resume', listener: () => void): unknown;
  getSystemIdleState(idleThresholdSeconds: number): 'active' | 'idle' | 'locked' | 'unknown';
}

export interface SystemEventsDeps {
  readonly monitor: PowerMonitorLike;
  /** Sends the event to the page; false when there is no window to send it to. */
  readonly send: (event: SystemLockEvent) => boolean;
  /** Whether the page last said it is locked. After a resume the event is sent again if it has not. */
  readonly pageLocked: () => boolean;
  /** Called on every system lock, even with no window: other surfaces (badge, tray, recent Folds) clear their data here. */
  readonly onSystemLock?: () => void;
  readonly now?: () => number;
  /** Runs `run` every `ms` until the returned function is called. */
  readonly every?: (run: () => void, ms: number) => () => void;
  readonly pollMs?: number;
  readonly debounceMs?: number;
}

export interface SystemEvents {
  start(): void;
  stop(): void;
  /** Behaves as if the system had reported this (used by the packaged tests). */
  report(reason: SystemLockEvent['reason']): void;
}

const IDLE_THRESHOLD_SECONDS = 60;

export function createSystemEvents(deps: SystemEventsDeps): SystemEvents {
  const now = deps.now ?? Date.now;
  const every =
    deps.every ??
    ((run, ms) => {
      const timer = setInterval(run, ms);
      timer.unref();
      return () => clearInterval(timer);
    });
  const debounceMs = deps.debounceMs ?? 1_000;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let stopPolling: (() => void) | undefined;
  let wasLocked = false;
  let started = false;

  const report = (reason: SystemLockEvent['reason']): void => {
    deps.onSystemLock?.();
    const at = now();
    if (at - lastSentAt < debounceMs) return;
    if (deps.send({ reason })) lastSentAt = at;
  };

  return {
    report,
    start() {
      if (started) return;
      started = true;
      deps.monitor.on('lock-screen', () => report('screen-lock'));
      deps.monitor.on('suspend', () => report('suspend'));
      deps.monitor.on('resume', () => {
        if (!deps.pageLocked()) report('suspend');
      });
      stopPolling = every(() => {
        const locked = deps.monitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) === 'locked';
        if (locked && !wasLocked) report('idle-state');
        wasLocked = locked;
      }, deps.pollMs ?? 5_000);
    },
    stop() {
      stopPolling?.();
      stopPolling = undefined;
    },
  };
}
