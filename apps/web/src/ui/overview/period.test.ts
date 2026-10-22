import { describe, expect, it } from 'vitest';
import { resolvePeriod } from './period';

const D = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;

describe('resolvePeriod', () => {
  const today = D(2025, 3, 15);
  it('this and last month cover whole calendar months', () => {
    expect(resolvePeriod({ kind: 'thisMonth' }, today)).toMatchObject({ from: '2025-03-01', to: '2025-03-31' });
    expect(resolvePeriod({ kind: 'lastMonth' }, today)).toMatchObject({ from: '2025-02-01', to: '2025-02-28' });
  });
  it('knows month lengths and leap years', () => {
    expect(resolvePeriod({ kind: 'lastMonth' }, D(2024, 3, 10))).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(resolvePeriod({ kind: 'thisMonth' }, D(2025, 4, 30))).toMatchObject({ from: '2025-04-01', to: '2025-04-30' });
  });
  it('last month wraps over the year boundary', () => {
    expect(resolvePeriod({ kind: 'lastMonth' }, D(2025, 1, 5))).toMatchObject({ from: '2024-12-01', to: '2024-12-31' });
  });
  it('this and last year cover whole calendar years', () => {
    expect(resolvePeriod({ kind: 'thisYear' }, today)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(resolvePeriod({ kind: 'lastYear' }, today)).toMatchObject({ from: '2024-01-01', to: '2024-12-31' });
  });
  it('last 30 and 90 days end today and include it', () => {
    expect(resolvePeriod({ kind: 'last30' }, today)).toMatchObject({ from: '2025-02-14', to: '2025-03-15' });
    expect(resolvePeriod({ kind: 'last90' }, D(2025, 3, 31))).toMatchObject({ from: '2025-01-01', to: '2025-03-31' });
  });
  it('all time has no bounds', () => {
    expect(resolvePeriod({ kind: 'all' }, today)).toMatchObject({ from: null, to: null });
  });
  it('a custom period is taken as given', () => {
    expect(resolvePeriod({ kind: 'custom', from: '2025-01-10', to: '2025-02-20' }, today)).toMatchObject({ from: '2025-01-10', to: '2025-02-20' });
  });
  it('names the period with a label key', () => {
    expect(resolvePeriod({ kind: 'thisMonth' }, today).labelKey).toBe('overview.period.thisMonth');
    expect(resolvePeriod({ kind: 'custom', from: '2025-01-10', to: '2025-02-20' }, today).labelKey).toBe('overview.period.custom');
  });
});
