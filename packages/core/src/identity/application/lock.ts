import type { Secret } from '../ports/index';

// The unlocked session. It owns the lifetime of every secret held in memory and decides when to lock (FR-006, FR-007, FR-017).
// Locking wipes every tracked secret first, then closes the database, then ends the worker, which discards its heap.

export interface LockPolicy {
  /** Lock after this long without activity. Default 5 minutes. */
  readonly idleMs: number;
  /** Lock after the page has been hidden this long. Default 1 minute. */
  readonly hiddenGraceMs: number;
}

export const DEFAULT_LOCK_POLICY: LockPolicy = { idleMs: 5 * 60_000, hiddenGraceMs: 60_000 };

export type SessionState = 'unlocked' | 'locked';

export interface Session {
  state(): SessionState;
  /** Whether the interface must hide financial content now: locked, hidden, or out of focus. */
  covered(): boolean;
  /** Takes responsibility for wiping `secret` when the session locks. A secret tracked after locking is wiped at once. */
  track<S extends Secret>(secret: S): S;
  release(secret: Secret): void;
  lock(): Promise<void>;
  activity(): void;
  visibility(state: 'visible' | 'hidden'): void;
  focus(focused: boolean): void;
  /** The page is going away (pagehide / freeze): lock immediately. */
  pageHide(): void;
  /** Checks the timers; call periodically and after clock changes. */
  tick(): void;
  unlockDelayMs(): number;
  recordFailedUnlock(): void;
  recordSuccessfulUnlock(): void;
}

export interface SessionDeps {
  closeDatabase(): Promise<void>;
  terminateWorker(): void;
  readonly policy?: LockPolicy;
  nowMs(): number;
}

const FREE_ATTEMPTS = 3;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

export function createSession(deps: SessionDeps): Session {
  const policy = deps.policy ?? DEFAULT_LOCK_POLICY;
  const tracked = new Set<Secret>();
  let state: SessionState = 'unlocked';
  let teardown: Promise<void> | undefined;
  let lastActivity = deps.nowMs();
  let hiddenSince: number | undefined;
  let focused = true;
  let failures = 0;
  let blockedUntil = 0;

  function wipe(secret: Secret): void {
    try {
      secret.wipe();
    } catch {
      // Keep going: one stuck buffer must not keep the others in memory.
    }
  }

  function lock(): Promise<void> {
    if (teardown !== undefined) return teardown;
    state = 'locked'; // from here on nothing is shown, even while the teardown finishes
    const secrets = [...tracked];
    tracked.clear();
    secrets.forEach(wipe);
    teardown = (async () => {
      try {
        await deps.closeDatabase();
      } catch {
        // The worker is terminated next, which closes the file regardless.
      } finally {
        deps.terminateWorker();
      }
    })();
    return teardown;
  }

  return {
    state: () => state,
    covered: () => state === 'locked' || hiddenSince !== undefined || !focused,
    track(secret) {
      if (state === 'locked') wipe(secret);
      else tracked.add(secret);
      return secret;
    },
    release: (secret) => void tracked.delete(secret),
    lock,
    activity() {
      if (state === 'unlocked') lastActivity = deps.nowMs();
    },
    visibility(v) {
      if (state !== 'unlocked') return;
      if (v === 'hidden') hiddenSince ??= deps.nowMs();
      else {
        hiddenSince = undefined;
        lastActivity = deps.nowMs();
      }
    },
    focus(f) {
      focused = f;
    },
    pageHide() {
      void lock();
    },
    tick() {
      if (state !== 'unlocked') return;
      const now = deps.nowMs();
      if (now - lastActivity >= policy.idleMs || (hiddenSince !== undefined && now - hiddenSince >= policy.hiddenGraceMs)) void lock();
    },
    unlockDelayMs: () => Math.max(0, blockedUntil - deps.nowMs()),
    recordFailedUnlock() {
      failures++;
      if (failures > FREE_ATTEMPTS) {
        const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(failures - FREE_ATTEMPTS - 1, 20));
        blockedUntil = deps.nowMs() + delay;
      }
    },
    recordSuccessfulUnlock() {
      failures = 0;
      blockedUntil = 0;
    },
  };
}
