import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';

/** Hybrid logical clock `(wall_ms: u48, ctr: u16)` (ARCH 9.2). Both fields are plain counters, never money. */
export interface Hlc {
  readonly wallMs: number;
  readonly ctr: number;
}

/** A clock value tied to the device that produced it, so distinct stamps never compare equal. */
export interface Stamp {
  readonly hlc: Hlc;
  readonly dev: Id;
}

export const MAX_CTR = 0xffff;
export const MAX_WALL_MS = 2 ** 48 - 1;
/** Remote operations stamped further than this ahead of local time are quarantined (ARCH 9.2). */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const ZERO_HLC: Hlc = { wallMs: 0, ctr: 0 };

export type HlcError = DomainError<'clock_overflow' | 'remote_too_far_ahead'>;

export const compareHlc = (a: Hlc, b: Hlc): number => a.wallMs - b.wallMs || a.ctr - b.ctr;

/** Total order `(wall, ctr, dev)`. Lowercase canonical UUID text sorts the same as the bytes. */
export function compareStamp(a: Stamp, b: Stamp): number {
  const byClock = compareHlc(a.hlc, b.hlc);
  if (byClock !== 0) return byClock;
  return a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0;
}

/** Counter overflow (65,535 events in one millisecond) advances wall time by 1 ms. */
function normalise(wallMs: number, ctr: number): Result<Hlc, DomainError<'clock_overflow'>> {
  if (ctr > MAX_CTR) return normalise(wallMs + 1, 0);
  if (wallMs > MAX_WALL_MS) return err('clock_overflow', 'Hybrid logical clock wall time exceeded 48 bits');
  return ok({ wallMs, ctr });
}

/** Local or send event. */
export function tick(local: Hlc, nowMs: number): Result<Hlc, DomainError<'clock_overflow'>> {
  const wall = Math.max(local.wallMs, nowMs);
  return normalise(wall, wall === local.wallMs ? local.ctr + 1 : 0);
}

/** Receive event: merges a remote clock; the result is strictly after both inputs. */
export function receive(local: Hlc, remote: Hlc, nowMs: number): Result<Hlc, HlcError> {
  if (remote.wallMs > nowMs + MAX_FUTURE_MS) {
    return err('remote_too_far_ahead', 'Remote clock is more than 24 hours ahead of this device');
  }
  const wall = Math.max(local.wallMs, remote.wallMs, nowMs);
  const fromLocal = wall === local.wallMs;
  const fromRemote = wall === remote.wallMs;
  const ctr = fromLocal && fromRemote ? Math.max(local.ctr, remote.ctr) + 1 : fromLocal ? local.ctr + 1 : fromRemote ? remote.ctr + 1 : 0;
  return normalise(wall, ctr);
}
