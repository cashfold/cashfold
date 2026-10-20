import { beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '../../../shared-kernel/id';
import { LedgerFixture, date, id } from '../../../testing/index';
import { TABLE, LABEL_FIELD } from '../../domain/tables';
import { buildLedger, type Ledger } from '../projections/ledger';
import { searchTransactions, type SearchFilter, type SearchSort } from './search';

const PAYEE_A = id(0x51);
const PAYEE_B = id(0x52);
const TAG_FUN = id(0x61);
const TAG_WORK = id(0x62);

interface World {
  f: LedgerFixture;
  checking: Id;
  euro: Id;
  food: Id;
  groceries: Id;
  salary: Id;
  t: Record<string, Id>;
}

function world(): World {
  const f = new LedgerFixture();
  const checking = f.account({ name: 'Checking', currency: 'USD' as never });
  const euro = f.account({ name: 'Euro wallet', currency: 'EUR' as never });
  const food = f.category({ name: 'Food', direction: 'expense' });
  const groceries = f.category({ name: 'Groceries', direction: 'expense', parentId: food });
  const salary = f.category({ name: 'Salary', direction: 'income' });
  f.apply(PAYEE_A, TABLE.payee, new Map([[LABEL_FIELD.name, 'Café Nero']]));
  f.apply(PAYEE_B, TABLE.payee, new Map([[LABEL_FIELD.name, 'Employer Ltd']]));
  f.apply(TAG_FUN, TABLE.tag, new Map([[LABEL_FIELD.name, 'fun']]));
  f.apply(TAG_WORK, TABLE.tag, new Map([[LABEL_FIELD.name, 'work']]));

  const t: Record<string, Id> = {};
  t.coffee = f.transaction(checking, { amountMinor: -450n, categoryId: food, payeeId: PAYEE_A, note: 'flat white', localDate: date(2026, 1, 5), tagIds: [TAG_FUN] });
  t.shop = f.transaction(checking, { amountMinor: -12_000n, categoryId: groceries, note: 'Weekly SHOP', localDate: date(2026, 1, 10) });
  t.pay = f.transaction(checking, { amountMinor: 300_000n, categoryId: salary, payeeId: PAYEE_B, localDate: date(2026, 1, 25), tagIds: [TAG_WORK] });
  t.pending = f.transaction(checking, { amountMinor: -999n, status: 'pending', localDate: date(2026, 2, 1), note: 'later' });
  t.void = f.transaction(checking, { amountMinor: -111n, status: 'void', localDate: date(2026, 2, 2) });
  t.euro = f.transaction(euro, { amountMinor: -2_500n, currency: 'EUR' as never, baseAmountMinor: -2_700n, localDate: date(2026, 1, 12), note: 'train', tagIds: [TAG_FUN, TAG_WORK] });
  t.gone = f.transaction(checking, { amountMinor: -77n, localDate: date(2026, 1, 6), note: 'deleted one' });
  f.remove(t.gone!, TABLE.transaction);
  return { f, checking, euro, food, groceries, salary, t };
}

describe('search', () => {
  let w: World;
  let ledger: Ledger;
  const ids = (filter: SearchFilter = {}, sort?: SearchSort) => searchTransactions(ledger, filter, sort).map((t) => t.id);
  const named = (filter: SearchFilter = {}, sort?: SearchSort) => {
    const byId = new Map(Object.entries(w.t).map(([k, v]) => [v, k]));
    return ids(filter, sort).map((i) => byId.get(i));
  };

  beforeEach(() => {
    w = world();
    ledger = buildLedger(w.f.fold);
  });

  it('returns every visible transaction, newest first, and never a deleted one', () => {
    expect(named()).toEqual(['void', 'pending', 'pay', 'euro', 'shop', 'coffee']);
  });

  it('filters by account', () => {
    expect(named({ accountIds: [w.euro] })).toEqual(['euro']);
    expect(named({ accountIds: [w.euro, w.checking] })).toHaveLength(6);
  });

  it('filters by category, including the children of a root category', () => {
    expect(named({ categoryIds: [w.food] })).toEqual(['shop', 'coffee']);
    expect(named({ categoryIds: [w.groceries] })).toEqual(['shop']);
    expect(named({ categoryIds: [w.food], includeChildCategories: false })).toEqual(['coffee']);
  });

  it('finds uncategorised transactions', () => {
    expect(named({ uncategorised: true })).toEqual(['void', 'pending', 'euro']);
  });

  it('filters by payee', () => {
    expect(named({ payeeIds: [PAYEE_A] })).toEqual(['coffee']);
    expect(named({ payeeIds: [PAYEE_A, PAYEE_B] })).toEqual(['pay', 'coffee']);
  });

  it('filters by tag: any of them by default, all of them on request', () => {
    expect(named({ tagIds: [TAG_FUN, TAG_WORK] })).toEqual(['pay', 'euro', 'coffee']);
    expect(named({ tagIds: [TAG_FUN, TAG_WORK], tagMode: 'all' })).toEqual(['euro']);
  });

  it('filters by amount range on the size of the amount, in one currency', () => {
    expect(named({ amount: { currency: 'USD', min: 400n, max: 20_000n } })).toEqual(['pending', 'shop', 'coffee']);
    expect(named({ amount: { currency: 'USD', min: 300_000n } })).toEqual(['pay']);
    expect(named({ amount: { currency: 'EUR', max: 2_500n } })).toEqual(['euro']);
    expect(named({ amount: { currency: 'EUR', min: 2_501n } })).toEqual([]);
  });

  it('filters by date range, both ends inclusive', () => {
    expect(named({ from: date(2026, 1, 10), to: date(2026, 1, 12) })).toEqual(['euro', 'shop']);
    expect(named({ from: date(2026, 1, 25) })).toEqual(['void', 'pending', 'pay']);
    expect(named({ to: date(2026, 1, 5) })).toEqual(['coffee']);
  });

  it('filters by status', () => {
    expect(named({ statuses: ['pending'] })).toEqual(['pending']);
    expect(named({ statuses: ['pending', 'void'] })).toEqual(['void', 'pending']);
  });

  it('matches text in notes, case- and accent-insensitively', () => {
    expect(named({ text: 'shop' })).toEqual(['shop']);
    expect(named({ text: 'WHITE' })).toEqual(['coffee']);
  });

  it('matches text in the payee, category, account, tag and place', () => {
    expect(named({ text: 'cafe' })).toEqual(['coffee']); // "Café Nero"
    expect(named({ text: 'groceries' })).toEqual(['shop']);
    expect(named({ text: 'euro wallet' })).toEqual(['euro']);
    expect(named({ text: 'work' })).toEqual(['pay', 'euro']);
  });

  it('requires every word of the text to match', () => {
    expect(named({ text: 'weekly shop' })).toEqual(['shop']);
    expect(named({ text: 'weekly coffee' })).toEqual([]);
  });

  it('combines filters with AND', () => {
    expect(named({ accountIds: [w.checking], tagIds: [TAG_FUN], from: date(2026, 1, 1) })).toEqual(['coffee']);
  });

  it('sorts by date either way, with ties broken by id so the order is stable', () => {
    expect(named({}, 'date_asc')).toEqual(['coffee', 'shop', 'euro', 'pay', 'pending', 'void']);
    const same = new LedgerFixture();
    const a = same.account();
    const x = same.transaction(a, { localDate: date(2026, 3, 3) }, id(30));
    const y = same.transaction(a, { localDate: date(2026, 3, 3) }, id(20));
    const out = searchTransactions(buildLedger(same.fold), {}, 'date_desc').map((t) => t.id);
    expect(out).toEqual([x, y].sort().reverse());
    expect(searchTransactions(buildLedger(same.fold), {}, 'date_desc').map((t) => t.id)).toEqual(out);
  });

  it('sorts by size of the amount in the base currency', () => {
    expect(named({ statuses: ['posted'] }, 'amount_desc')).toEqual(['pay', 'shop', 'euro', 'coffee']);
    expect(named({ statuses: ['posted'] }, 'amount_asc')).toEqual(['coffee', 'euro', 'shop', 'pay']);
  });

  it('pages the result', () => {
    expect(searchTransactions(ledger, {}, 'date_desc', { limit: 2, offset: 1 }).map((t) => t.id)).toEqual(ids().slice(1, 3));
    expect(searchTransactions(ledger, {}, 'date_desc', { limit: 10, offset: 100 })).toEqual([]);
  });

  it('is a pure read of the ledger: it neither mutates nor depends on call order', () => {
    const before = ids();
    ids({ text: 'x' });
    expect(ids()).toEqual(before);
  });
});
