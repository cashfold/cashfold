import { describe, expect, it } from 'vitest';
import { budgetStatus, goalStatus } from './status';

describe('budgetStatus', () => {
  it('is on track below 80 %', () => {
    expect(budgetStatus(7_999n, 10_000n)).toEqual({ textKey: 'plan.status.onTrack', tone: 'good', progressBps: 7_999 });
    expect(budgetStatus(0n, 10_000n).progressBps).toBe(0);
  });
  it('is near the limit from 80 % up to and including 100 %', () => {
    expect(budgetStatus(8_000n, 10_000n).textKey).toBe('plan.status.near');
    expect(budgetStatus(10_000n, 10_000n)).toEqual({ textKey: 'plan.status.near', tone: 'warning', progressBps: 10_000 });
  });
  it('is over beyond the limit and the bar stops at full', () => {
    expect(budgetStatus(10_001n, 10_000n)).toEqual({ textKey: 'plan.status.over', tone: 'danger', progressBps: 10_000 });
  });
  it('stays exact for amounts beyond 2^53', () => {
    const limit = 9_007_199_254_740_993n;
    expect(budgetStatus(limit - 1n, limit).textKey).toBe('plan.status.near');
    expect(budgetStatus(limit + 1n, limit).textKey).toBe('plan.status.over');
  });
  it('treats a zero limit as nothing to compare', () => {
    expect(budgetStatus(5n, 0n).progressBps).toBe(0);
  });
});

describe('goalStatus', () => {
  const today = 20250615;
  it('is in progress until the target is reached', () => {
    expect(goalStatus(500n, 1_000n, 20251231, today)).toEqual({ textKey: 'plan.status.inProgress', tone: 'neutral', progressBps: 5_000 });
    expect(goalStatus(0n, 1_000n, null, today).progressBps).toBe(0);
  });
  it('is reached at the target, even past the date', () => {
    expect(goalStatus(1_000n, 1_000n, 20240101, today)).toEqual({ textKey: 'plan.status.reached', tone: 'good', progressBps: 10_000 });
  });
  it('is overdue after the date without reaching the target', () => {
    expect(goalStatus(500n, 1_000n, 20250614, today).textKey).toBe('plan.status.overdue');
    expect(goalStatus(500n, 1_000n, 20250615, today).textKey).toBe('plan.status.inProgress');
  });
});
