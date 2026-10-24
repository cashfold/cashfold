// In-memory rate limiting and back-off. State lives in this process: a restart forgets it, which only ever helps an
// attacker once per restart, and a multi-instance deployment puts these counters behind the same interface in Redis or
// PostgreSQL (docs/self-hosting.md).

export interface Clock {
  now(): number;
}

export type Decision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSec: number };

export interface RateLimiter {
  /** Counts one event against `key`; refuses once more than `limit` happened in the last `windowMs`. */
  hit(key: string, limit: number, windowMs: number): Decision;
}

/** `scale` multiplies every limit. It is 1 in production; test setups that sign in many accounts from one address raise it. */
export function createRateLimiter(clock: Clock, scale = 1): RateLimiter {
  const events = new Map<string, number[]>();
  let sweepAt = 0;
  return {
    hit(key, limit, windowMs) {
      const now = clock.now();
      if (now >= sweepAt) {
        for (const [k, times] of events) if (times.every((t) => now - t > 24 * 3_600_000)) events.delete(k);
        sweepAt = now + 60_000;
      }
      const recent = (events.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit * scale) {
        events.set(key, recent);
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
      }
      recent.push(now);
      events.set(key, recent);
      return { allowed: true };
    },
  };
}

export interface BackoffPolicy {
  /** Failures allowed before the first delay. */
  readonly free: number;
  readonly baseMs: number;
  readonly maxMs: number;
}

export const SIGN_IN_BACKOFF: BackoffPolicy = { free: 4, baseMs: 2_000, maxMs: 15 * 60_000 };

/** Failed attempts per subject (account or stand-in for an unknown address) with exponential back-off after a few free tries. */
export function createFailureTracker(clock: Clock, policy: BackoffPolicy = SIGN_IN_BACKOFF) {
  const failures = new Map<string, { count: number; lockedUntil: number; at: number }>();
  let sweepAt = 0;
  /** Forgets subjects that have not failed for a day, so addresses that were only ever guessed at do not pile up. */
  const sweep = (): void => {
    const now = clock.now();
    if (now < sweepAt) return;
    sweepAt = now + 60_000;
    for (const [k, f] of failures) if (now - f.at > 24 * 3_600_000 && f.lockedUntil <= now) failures.delete(k);
  };
  return {
    /** Milliseconds the subject must wait, or 0. */
    waitMs(key: string): number {
      const f = failures.get(key);
      return f === undefined ? 0 : Math.max(0, f.lockedUntil - clock.now());
    },
    /** Records a failure. Returns the new count and when the subject may try again. */
    fail(key: string): { count: number; lockedUntil: number | null } {
      sweep();
      const count = (failures.get(key)?.count ?? 0) + 1;
      const over = count - policy.free;
      const lockedUntil = over > 0 ? clock.now() + Math.min(policy.baseMs * 2 ** (over - 1), policy.maxMs) : 0;
      failures.set(key, { count, lockedUntil, at: clock.now() });
      return { count, lockedUntil: over > 0 ? lockedUntil : null };
    },
    succeed(key: string): void {
      failures.delete(key);
    },
  };
}
