import type { Id } from '../../shared-kernel/id';
import { MAX_FUTURE_MS } from '../domain/hlc';
import type { QuarantinedOp } from '../ports/index';

// An op stamped more than 24 hours ahead of this device's clock is not applied (it would otherwise pull every later local
// stamp past it). It is kept aside, and the person is told, because the usual cause is a wrong clock on one of the devices.

/** True when `wallMs` is further ahead of `nowMs` than the safety window allows. Ops from the past are always fine. */
export const isBeyondClockWindow = (wallMs: number, nowMs: number): boolean => wallMs - nowMs > MAX_FUTURE_MS;

export interface ClockNotice {
  readonly kind: 'clock_ahead';
  readonly op: Id;
  /** The device that wrote the op: its clock, or this device's, is wrong. */
  readonly dev: Id;
  readonly aheadByMs: number;
  readonly atMs: number;
  readonly messageKey: 'attention.clock_ahead';
}

/** The user-visible notices for quarantined ops that were set aside for their timestamp, most recent first. */
export function clockNotices(quarantined: readonly QuarantinedOp[], nowMs: number): ClockNotice[] {
  return quarantined
    .filter((q) => q.reason === 'clock_ahead')
    .map((q): ClockNotice => ({ kind: 'clock_ahead', op: q.sealed.op, dev: q.sealed.dev, aheadByMs: q.sealed.hlc.wallMs - nowMs, atMs: q.atMs, messageKey: 'attention.clock_ahead' }))
    .sort((a, b) => b.atMs - a.atMs);
}
