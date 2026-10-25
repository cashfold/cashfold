// The desktop app's own check that the person is still there. The Core Worker has an idle timer too, but every call the page makes to the worker
// counts as activity for it, and the page polls the sync status every fifteen seconds, so on a window that stays open the worker's timer is never
// reached. A browser tab is protected by hiding and the short hidden-window time (lock-policy.ts); the desktop app does not use those, so the idle
// time has to work by itself: it counts only the person's own input.

export interface IdleLockDeps {
  readonly now: () => number;
  /** The person's "lock after no activity" setting in minutes, or undefined when it cannot be read (then nothing locks here). */
  readonly idleMinutes: () => Promise<number | undefined>;
  readonly lock: () => void;
  /** How long a read setting is trusted before it is read again. */
  readonly refreshMs?: number;
}

export interface IdleLock {
  /** The person did something (a key, a click, the pointer or the wheel moved). */
  input(): void;
  /** Reads the setting if it is stale and locks if the person has been away for the idle time. Returns whether it locked. */
  check(): Promise<boolean>;
}

export function createIdleLock(deps: IdleLockDeps): IdleLock {
  const refreshMs = deps.refreshMs ?? 30_000;
  let lastInput = deps.now();
  let minutes: number | undefined;
  let readAt = Number.NEGATIVE_INFINITY;
  return {
    input() {
      lastInput = deps.now();
    },
    async check() {
      const now = deps.now();
      if (now - readAt >= refreshMs) {
        readAt = now;
        minutes = await deps.idleMinutes().catch(() => undefined);
      }
      if (minutes === undefined || !(minutes > 0)) return false;
      if (deps.now() - lastInput < minutes * 60_000) return false;
      deps.lock();
      return true;
    },
  };
}
