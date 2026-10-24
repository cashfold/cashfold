import { describe, expect, it } from 'vitest';
import { createFailureTracker, createRateLimiter } from './rate-limit.js';

const HOUR = 3_600_000;

describe('createRateLimiter', () => {
  it('refuses once the limit is reached within the window, and allows again after it', () => {
    let now = 0;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < 3; i++) expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
    expect(limiter.hit('k', 3, 60_000)).toEqual({ allowed: false, retryAfterSec: 60 });
    now = 61_000;
    expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
  });

  it('multiplies every limit by the scale', () => {
    const limiter = createRateLimiter({ now: () => 0 }, 2);
    for (let i = 0; i < 6; i++) expect(limiter.hit('k', 3, 60_000).allowed).toBe(true);
    expect(limiter.hit('k', 3, 60_000).allowed).toBe(false);
  });
});

describe('createFailureTracker', () => {
  it('lets a few failures through, then backs off, and forgets a success', () => {
    let now = 0;
    const tracker = createFailureTracker({ now: () => now });
    for (let i = 0; i < 4; i++) expect(tracker.fail('a').lockedUntil).toBeNull();
    expect(tracker.fail('a').lockedUntil).toBe(2_000);
    expect(tracker.waitMs('a')).toBe(2_000);
    now = 2_000;
    expect(tracker.waitMs('a')).toBe(0);
    tracker.succeed('a');
    expect(tracker.fail('a').count).toBe(1);
  });

  it('forgets a subject that has not failed for a day, so guessed addresses do not pile up', () => {
    let now = 0;
    const tracker = createFailureTracker({ now: () => now });
    for (let i = 0; i < 5; i++) tracker.fail('old');
    now = 25 * HOUR;
    tracker.fail('other'); // the sweep runs on a failure
    expect(tracker.fail('old').count).toBe(1);
  });

  it('keeps a subject that is still locked or failed recently', () => {
    let now = 0;
    const tracker = createFailureTracker({ now: () => now });
    for (let i = 0; i < 5; i++) tracker.fail('recent');
    now = 12 * HOUR;
    tracker.fail('other');
    expect(tracker.fail('recent').count).toBe(6);
  });
});
