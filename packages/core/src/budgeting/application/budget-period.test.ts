import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { date, LedgerFixture } from '../../testing/index';
import { id } from '../../testing/world';
import { applyOp, emptyFold } from '../../sync/domain/merge';
import { buildLedger } from '../../ledger/application/projections/ledger';
import { TABLE, BUDGET_FIELD } from '../../ledger/domain/tables';
import type { Rollover } from '../domain/budget';
import { budgetPeriodAt, budgetPeriodOn, buildBudgets } from './budget-period';

const usd = (f: LedgerFixture, account = f.account()) => ({ f, account });

function view(f: LedgerFixture, budgetId: ReturnType<LedgerFixture['budget']>, index: number) {
  const budget = buildBudgets(f.fold).get(budgetId)!;
  return budgetPeriodAt(buildLedger(f.fold), budget, index);
}

describe('BudgetPeriod: the Groceries scenario', () => {
  const run = (rollover: Rollover, spendMonthOne: bigint, spendMonthTwo = 0n) => {
    const { f, account } = usd(new LedgerFixture());
    const budget = f.budget({ limitMinor: 30_000n, rollover });
    f.transaction(account, { amountMinor: -spendMonthOne, localDate: date(2026, 1, 10) });
    if (spendMonthTwo > 0n) f.transaction(account, { amountMinor: -spendMonthTwo, localDate: date(2026, 2, 10) });
    return { f, budget };
  };

  it('carry positive: 300.00 limit, 120.00 spent ⇒ month two shows 480.00', () => {
    const { f, budget } = run('carry_positive', 12_000n);
    expect(view(f, budget, 0)).toMatchObject({ carryInMinor: 0n, spentMinor: 12_000n, availableMinor: 18_000n });
    expect(view(f, budget, 1)).toMatchObject({ carryInMinor: 18_000n, availableMinor: 48_000n });
  });

  it('none: month two shows 300.00', () => {
    const { f, budget } = run('none', 12_000n);
    expect(view(f, budget, 1)).toMatchObject({ carryInMinor: 0n, availableMinor: 30_000n });
  });

  it('carry positive drops an overspend; carry all keeps it', () => {
    const positive = run('carry_positive', 40_000n);
    expect(view(positive.f, positive.budget, 0).availableMinor).toBe(-10_000n);
    expect(view(positive.f, positive.budget, 1)).toMatchObject({ carryInMinor: 0n, availableMinor: 30_000n });
    const all = run('carry_all', 40_000n);
    expect(view(all.f, all.budget, 1)).toMatchObject({ carryInMinor: -10_000n, availableMinor: 20_000n });
  });

  it('carries across several quiet periods', () => {
    const { f, budget } = run('carry_positive', 12_000n);
    expect(view(f, budget, 3)).toMatchObject({ carryInMinor: 18_000n + 30_000n * 2n, availableMinor: 18_000n + 30_000n * 3n });
  });

  it('uses the allocation, not the limit, for what is available', () => {
    const { f, account } = usd(new LedgerFixture());
    const budget = f.budget({ limitMinor: 30_000n, allocationMinor: 20_000n });
    f.transaction(account, { amountMinor: -5_000n, localDate: date(2026, 1, 10) });
    expect(view(f, budget, 0)).toMatchObject({ limitMinor: 30_000n, allocationMinor: 20_000n, availableMinor: 15_000n });
  });
});

describe('BudgetPeriod: what counts as spent', () => {
  it('refunds reduce spent; pending, void, adjustments and income do not add', () => {
    const { f, account } = usd(new LedgerFixture());
    const b = f.budget();
    f.transaction(account, { amountMinor: -5_000n, localDate: date(2026, 1, 5) });
    f.transaction(account, { amountMinor: 1_000n, isRefund: true, localDate: date(2026, 1, 6) });
    f.transaction(account, { amountMinor: -9_000n, status: 'pending', localDate: date(2026, 1, 7) });
    f.transaction(account, { amountMinor: -9_000n, status: 'void', localDate: date(2026, 1, 7) });
    f.transaction(account, { amountMinor: -9_000n, direction: 'adjustment', localDate: date(2026, 1, 7) });
    f.transaction(account, { amountMinor: 9_000n, localDate: date(2026, 1, 8) });
    expect(view(f, b, 0).spentMinor).toBe(4_000n);
  });

  it('an income budget counts income, not refunds', () => {
    const { f, account } = usd(new LedgerFixture());
    const b = f.budget({ direction: 'income', limitMinor: 100_000n });
    f.transaction(account, { amountMinor: 60_000n, localDate: date(2026, 1, 5) });
    f.transaction(account, { amountMinor: 1_000n, isRefund: true, localDate: date(2026, 1, 6) });
    f.transaction(account, { amountMinor: -5_000n, localDate: date(2026, 1, 7) });
    expect(view(f, b, 0).spentMinor).toBe(60_000n);
  });

  it('ignores transactions before the anchor and in other periods', () => {
    const { f, account } = usd(new LedgerFixture());
    const b = f.budget({ anchorLocalDate: date(2026, 2, 1) });
    f.transaction(account, { amountMinor: -5_000n, localDate: date(2026, 1, 31) });
    f.transaction(account, { amountMinor: -700n, localDate: date(2026, 2, 28) });
    f.transaction(account, { amountMinor: -300n, localDate: date(2026, 3, 1) });
    expect(view(f, b, 0).spentMinor).toBe(700n);
    expect(view(f, b, 1).spentMinor).toBe(300n);
  });

  it('scope: accounts, groups, categories (with children) and tags', () => {
    const f = new LedgerFixture();
    const cash = f.account({ name: 'Cash' });
    const card = f.account({ name: 'Card' });
    const food = f.category({ name: 'Food' });
    const veg = f.category({ name: 'Veg', parentId: food });
    const fun = f.category({ name: 'Fun' });
    const tagA = f.nextId();
    f.transaction(cash, { amountMinor: -100n, categoryId: food });
    f.transaction(cash, { amountMinor: -200n, categoryId: veg });
    f.transaction(card, { amountMinor: -400n, categoryId: veg });
    f.transaction(cash, { amountMinor: -800n, categoryId: fun, tagIds: [tagA] });
    f.transaction(cash, { amountMinor: -1_600n });
    const spent = (scope: Parameters<LedgerFixture['budget']>[0] extends infer T ? (T extends { scope?: infer S } ? S : never) : never) => view(f, f.budget({ scope }), 0).spentMinor;
    expect(spent({})).toBe(3_100n);
    expect(spent({ accountIds: [cash] })).toBe(2_700n);
    expect(spent({ categoryIds: [food] })).toBe(700n);
    expect(spent({ categoryIds: [veg] })).toBe(600n);
    expect(spent({ categoryIds: [food], accountIds: [cash] })).toBe(300n);
    expect(spent({ tagIds: [tagA] })).toBe(800n);
  });

  it('transfers count only when included, from the leaving side for expenses', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const b = f.account();
    f.transfer(a, b, { from: 5_000n });
    const without = f.budget();
    const withTransfers = f.budget({ scope: { includeTransfers: true } });
    const income = f.budget({ direction: 'income', scope: { includeTransfers: true } });
    const onlyB = f.budget({ scope: { includeTransfers: true, accountIds: [b] } });
    const byCategory = f.budget({ scope: { includeTransfers: true, categoryIds: [f.category()] } });
    expect(view(f, without, 0).spentMinor).toBe(0n);
    expect(view(f, withTransfers, 0).spentMinor).toBe(5_000n);
    expect(view(f, income, 0).spentMinor).toBe(5_000n);
    expect(view(f, onlyB, 0).spentMinor).toBe(0n);
    expect(view(f, byCategory, 0).spentMinor).toBe(0n);
  });

  it('converts other currencies exactly and reports a missing rate instead of guessing', () => {
    const f = new LedgerFixture();
    const eur = f.account({ currency: 'EUR' as never });
    const b = f.budget({ currency: 'USD' });
    f.transaction(eur, { amountMinor: -1_000n, currency: 'EUR' as never, baseAmountMinor: -1_000n, baseCurrency: 'EUR', localDate: date(2026, 1, 10) });
    expect(view(f, b, 0)).toMatchObject({ spentMinor: 0n, missingRates: ['EUR'] });
    f.exchangeRate({ quote: 'EUR', asOfUtcS: Date.UTC(2026, 0, 1) / 1000, rateE12: 800_000_000_000n, source: 'custom' } as never);
    expect(view(f, b, 0)).toMatchObject({ spentMinor: 1_250n, missingRates: [] });
  });

  it('uses the base amount frozen at entry when it is already in the budget currency', () => {
    const f = new LedgerFixture();
    const eur = f.account({ currency: 'EUR' as never });
    const b = f.budget({ currency: 'USD' });
    f.transaction(eur, { amountMinor: -1_000n, currency: 'EUR' as never, baseAmountMinor: -1_090n, baseCurrency: 'USD', localDate: date(2026, 1, 10) });
    expect(view(f, b, 0)).toMatchObject({ spentMinor: 1_090n, missingRates: [] });
  });

  it('budgetPeriodOn finds the current period and nothing before the anchor', () => {
    const f = new LedgerFixture();
    const b = f.budget({ anchorLocalDate: date(2026, 3, 1) });
    const budget = buildBudgets(f.fold).get(b)!;
    expect(budgetPeriodOn(buildLedger(f.fold), budget, date(2026, 2, 28))).toBeUndefined();
    expect(budgetPeriodOn(buildLedger(f.fold), budget, date(2026, 4, 2))?.index).toBe(1);
  });
});

describe('BudgetPeriod: recomputation after history changes', () => {
  it('editing, deleting and restoring an old transaction recomputes later carry-in', () => {
    const f = new LedgerFixture();
    const account = f.account();
    const b = f.budget({ limitMinor: 30_000n, rollover: 'carry_positive' });
    const t = f.transaction(account, { amountMinor: -12_000n, localDate: date(2026, 1, 10) });
    expect(view(f, b, 1).availableMinor).toBe(48_000n);
    f.remove(t, TABLE.transaction);
    expect(view(f, b, 1).availableMinor).toBe(60_000n);
    f.restore(t, TABLE.transaction);
    expect(view(f, b, 1).availableMinor).toBe(48_000n);
    f.edit(t, TABLE.transaction, new Map([[10, BigInt(date(2026, 2, 10))]]));
    expect(view(f, b, 0).spentMinor).toBe(0n);
    expect(view(f, b, 1)).toMatchObject({ spentMinor: 12_000n, carryInMinor: 30_000n, availableMinor: 48_000n });
  });

  it('two replicas applying the same operations in any order compute identical periods', () => {
    const rollovers: Rollover[] = ['none', 'carry_positive', 'carry_all'];
    fc.assert(
      fc.property(
        fc.array(fc.record({ day: fc.integer({ min: 1, max: 28 }), month: fc.integer({ min: 1, max: 5 }), amount: fc.integer({ min: 1, max: 50_000 }), refund: fc.boolean(), del: fc.boolean() }), { maxLength: 12 }),
        fc.constantFrom(...rollovers),
        fc.infiniteStream(fc.nat()),
        (txns, rollover, entropy) => {
          const f = new LedgerFixture();
          const account = f.account({}, id(1));
          const b = f.budget({ limitMinor: 30_000n, rollover }, id(2));
          const ids = txns.map((t, i) => f.transaction(account, {
            amountMinor: t.refund ? BigInt(t.amount) : -BigInt(t.amount), isRefund: t.refund, direction: t.refund ? 'income' : 'expense',
            localDate: date(2026, t.month, t.day),
          }, id(100 + i)));
          txns.forEach((t, i) => { if (t.del) f.remove(ids[i]!, TABLE.transaction); });
          // A second replica receives the same operations in a different order.
          const shuffled = [...f.ops].map((op, i) => ({ op, key: entropy.next().value as number + i })).sort((x, y) => x.key - y.key).map((x) => x.op);
          const other = shuffled.reduce((state, op) => applyOp(state, op), emptyFold());
          const read = (state: typeof f.fold, k: number) => budgetPeriodAt(buildLedger(state), buildBudgets(state).get(b)!, k);
          for (let k = 0; k < 6; k++) expect(read(other, k)).toEqual(read(f.fold, k));
        },
      ),
      { numRuns: 50 },
    );
  });

  it('a concurrent rollover change keeps the later write and recomputes from the same transactions', () => {
    const f = new LedgerFixture();
    const account = f.account();
    const b = f.budget({ limitMinor: 30_000n, rollover: 'none' });
    f.transaction(account, { amountMinor: -12_000n, localDate: date(2026, 1, 10) });
    f.apply(b, TABLE.budget, new Map([[BUDGET_FIELD.rollover, 1n]]), new Map(), 5_000);
    f.apply(b, TABLE.budget, new Map([[BUDGET_FIELD.rollover, 2n]]), new Map(), 4_000);
    expect(buildBudgets(f.fold).get(b)!.rollover).toBe('carry_positive');
    expect(view(f, b, 1).carryInMinor).toBe(18_000n);
  });
});
