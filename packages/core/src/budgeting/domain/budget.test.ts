import { describe, expect, it } from 'vitest';
import { addDays } from '../../shared-kernel/local-date';
import { date } from '../../testing/index';
import { emptyFold } from '../../sync/domain/merge';
import { id } from '../../testing/world';
import {
  budgetFieldPatch, decodeBudget, periodContaining, periodSpan, validateBudgetUpdate, validateNewBudget, type NewBudgetInput,
} from './budget';
import { TABLE } from '../../ledger/domain/tables';
import { applyOp } from '../../sync/domain/merge';

const base: NewBudgetInput = { name: 'Groceries', direction: 'expense', periodUnit: 'month', anchorLocalDate: date(2026, 1, 1), limitMinor: 30_000n, currency: 'USD' };

describe('Budget validation', () => {
  it('defaults the allocation to the limit, the interval to 1 and the rollover to none', () => {
    const v = validateNewBudget(base);
    expect(v).toMatchObject({ ok: true, value: { allocationMinor: 30_000n, periodInterval: 1, rollover: 'none', customEndLocalDate: null } });
  });

  it('accepts a zero limit and a zero allocation but not a negative one', () => {
    expect(validateNewBudget({ ...base, limitMinor: 0n })).toMatchObject({ ok: true });
    expect(validateNewBudget({ ...base, allocationMinor: 0n })).toMatchObject({ ok: true });
    expect(validateNewBudget({ ...base, limitMinor: -1n })).toMatchObject({ ok: false, error: { code: 'invalid_limit' } });
    expect(validateNewBudget({ ...base, allocationMinor: -1n })).toMatchObject({ ok: false, error: { code: 'invalid_allocation' } });
  });

  it('requires an interval of at least 1', () => {
    for (const periodInterval of [0, -2, 1.5]) expect(validateNewBudget({ ...base, periodInterval })).toMatchObject({ ok: false, error: { code: 'invalid_interval' } });
    expect(validateNewBudget({ ...base, periodInterval: 3 })).toMatchObject({ ok: true });
  });

  it('knows expense and income budgets only', () => {
    expect(validateNewBudget({ ...base, direction: 'income' })).toMatchObject({ ok: true });
    expect(validateNewBudget({ ...base, direction: 'transfer' as never })).toMatchObject({ ok: false, error: { code: 'invalid_direction' } });
  });

  it('checks rollover, currency, name and the custom period', () => {
    expect(validateNewBudget({ ...base, rollover: 'carry_everything' as never })).toMatchObject({ ok: false, error: { code: 'invalid_rollover' } });
    expect(validateNewBudget({ ...base, currency: 'XXX1' })).toMatchObject({ ok: false });
    expect(validateNewBudget({ ...base, name: '  ' })).toMatchObject({ ok: false, error: { code: 'invalid_budget_name' } });
    const custom = { ...base, periodUnit: 'custom' as const };
    expect(validateNewBudget(custom)).toMatchObject({ ok: false, error: { code: 'invalid_custom_end' } });
    expect(validateNewBudget({ ...custom, customEndLocalDate: date(2025, 12, 31) })).toMatchObject({ ok: false, error: { code: 'invalid_custom_end' } });
    expect(validateNewBudget({ ...custom, customEndLocalDate: date(2026, 3, 31) })).toMatchObject({ ok: true });
  });

  it('keeps allocation equal to the limit on update only when they were equal', () => {
    const equal = validateNewBudget(base);
    if (!equal.ok) throw new Error('setup');
    expect(validateBudgetUpdate(equal.value, { limitMinor: 50_000n })).toMatchObject({ ok: true, value: { limitMinor: 50_000n, allocationMinor: 50_000n } });
    const split = validateNewBudget({ ...base, allocationMinor: 10_000n });
    if (!split.ok) throw new Error('setup');
    expect(validateBudgetUpdate(split.value, { limitMinor: 50_000n })).toMatchObject({ ok: true, value: { allocationMinor: 10_000n } });
  });
});

describe('Budget records', () => {
  it('round-trips through field patches', () => {
    const v = validateNewBudget({ ...base, rollover: 'carry_positive', periodInterval: 2 });
    if (!v.ok) throw new Error('setup');
    const rec = id(5);
    const state = applyOp(emptyFold(), { id: id(9), rec, dev: id(1), hlc: { wallMs: 1, ctr: 0 }, table: TABLE.budget, fields: budgetFieldPatch(v.value), sets: new Map() });
    expect(decodeBudget(rec, state.get(rec)!)).toMatchObject({ id: rec, name: 'Groceries', rollover: 'carry_positive', periodInterval: 2, limitMinor: 30_000n, allocationMinor: 30_000n });
  });

  it('a record missing its limit does not decode', () => {
    const rec = id(5);
    const state = applyOp(emptyFold(), { id: id(9), rec, dev: id(1), hlc: { wallMs: 1, ctr: 0 }, table: TABLE.budget, fields: new Map([[1, 'x']]), sets: new Map() });
    expect(decodeBudget(rec, state.get(rec)!)).toBeUndefined();
  });
});

describe('periods', () => {
  const monthly = { periodUnit: 'month', periodInterval: 1, anchorLocalDate: date(2026, 1, 31), customEndLocalDate: null } as const;

  it('counts months from the anchor so a 31st anchor does not drift', () => {
    expect([0, 1, 2, 3].map((k) => periodSpan(monthly, k).from)).toEqual([date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]);
    expect(periodSpan(monthly, 0).to).toBe(date(2026, 2, 27));
  });

  it('finds the period of a date, including before the anchor and day, week and year units', () => {
    expect(periodContaining(monthly, date(2026, 1, 30))).toBeUndefined();
    expect(periodContaining(monthly, date(2026, 3, 15))?.index).toBe(1);
    expect(periodContaining({ ...monthly, periodUnit: 'week', anchorLocalDate: date(2026, 1, 5) }, date(2026, 1, 19))?.index).toBe(2);
    expect(periodContaining({ ...monthly, periodUnit: 'day', periodInterval: 10, anchorLocalDate: date(2026, 1, 1) }, date(2026, 1, 25))?.index).toBe(2);
    expect(periodContaining({ ...monthly, periodUnit: 'year', anchorLocalDate: date(2024, 2, 29) }, date(2026, 2, 28))?.index).toBe(2);
  });

  it('every date lies in exactly the period that contains it, and periods tile without gaps', () => {
    const b = { ...monthly, periodInterval: 2, anchorLocalDate: date(2025, 12, 31) };
    for (let k = 0; k < 30; k++) {
      const span = periodSpan(b, k);
      expect(periodContaining(b, span.from)?.index).toBe(k);
      expect(periodContaining(b, span.to)?.index).toBe(k);
      expect(addDays(span.to, 1)).toBe(periodSpan(b, k + 1).from);
    }
  });

  it('a custom budget has one period', () => {
    const c = { ...monthly, periodUnit: 'custom', anchorLocalDate: date(2026, 5, 1), customEndLocalDate: date(2026, 5, 20) } as const;
    expect(periodContaining(c, date(2026, 5, 20))?.index).toBe(0);
    expect(periodContaining(c, date(2026, 5, 21))).toBeUndefined();
  });
});
