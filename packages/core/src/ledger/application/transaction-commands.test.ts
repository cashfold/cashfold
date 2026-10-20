import { beforeEach, describe, expect, it } from 'vitest';
import { id, ledgerHarness, date, type LedgerHarness } from '../../testing/index';
import { TABLE, LABEL_FIELD } from '../domain/tables';
import { createAccountCommands } from './account-commands';
import { accountBalance } from './balance';
import { RETENTION_MS, createTransactionCommands } from './transaction-commands';
import { createCategoryCommands } from './category-commands';

const accounts = createAccountCommands();
const categories = createCategoryCommands();
let h: LedgerHarness;
const txns = () => createTransactionCommands({ clock: { nowMs: () => h.clock.now } });

const MARCH = Date.UTC(2026, 2, 1, 12);
const add = (n: number, over: Record<string, unknown> = {}) => h.run(txns().addTransaction, {
  fold: h.fold, id: id(n), accountId: id(1), direction: 'expense' as const, amountMinor: -450n, currency: 'USD', occurredUtcMs: MARCH, tzOffsetMin: 0, ...over,
});
const balance = async () => {
  const r = accountBalance(await h.ledger(), id(1));
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

beforeEach(async () => {
  h = await ledgerHarness();
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 10_000n, openingDate: date(2026, 1, 1) });
});

describe('addTransaction', () => {
  it('records an expense and the balance falls by exactly that amount', async () => {
    const r = await add(10);
    expect(r).toMatchObject({ ok: true, value: { amountMinor: -450n, status: 'posted', localDate: 20_260_301, baseAmountMinor: -450n, baseCurrency: 'USD' } });
    expect(await balance()).toBe(9_550n);
  });

  it('records income and keeps amounts above 2^53 exact', async () => {
    const big = 2n ** 55n + 3n;
    await add(10, { direction: 'income', amountMinor: big });
    expect(await balance()).toBe(10_000n + big);
  });

  it('rejects a sign that contradicts the type, and writes nothing', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect(await add(10, { direction: 'expense', amountMinor: 450n })).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
  });

  it('rejects a currency that is not the account currency', async () => {
    expect(await add(10, { currency: 'EUR' })).toMatchObject({ ok: false, error: { code: 'currency_mismatch' } });
  });

  it('rejects an unknown account and a date before the opening date', async () => {
    expect(await add(10, { accountId: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await add(10, { occurredUtcMs: Date.UTC(2025, 11, 31, 12) })).toMatchObject({ ok: false, error: { code: 'before_opening_date' } });
  });

  it('a goal account refuses plain income and expense', async () => {
    await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(2), kind: 'goal', name: 'Holiday', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
    expect(await add(10, { accountId: id(2) })).toMatchObject({ ok: false, error: { code: 'goal_entries_restricted' } });
    expect((await add(11, { accountId: id(2), direction: 'adjustment', amountMinor: 500n })).ok).toBe(true);
  });

  it('keeps a pending entry out of the posted balance', async () => {
    await add(10, { status: 'pending' });
    expect(await balance()).toBe(10_000n);
  });

  it('checks the category: it must exist and match the direction', async () => {
    await h.run(categories.createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Food' });
    await h.run(categories.createCategory, { fold: h.fold, id: id(61), direction: 'income', parentId: null, name: 'Salary' });
    expect((await add(10, { categoryId: id(60) })).ok).toBe(true);
    expect(await add(11, { categoryId: id(61) })).toMatchObject({ ok: false, error: { code: 'category_direction_mismatch' } });
    expect(await add(12, { categoryId: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await add(13, { direction: 'adjustment', amountMinor: 5n, categoryId: id(60) })).toMatchObject({ ok: false, error: { code: 'category_not_allowed' } });
  });

  it('stores up to eight tags and refuses the ninth', async () => {
    const tags = Array.from({ length: 9 }, (_, i) => id(200 + i));
    for (const t of tags) await h.replica.writePath.submit({ fold: h.fold, rec: t, table: TABLE.tag, fields: new Map([[LABEL_FIELD.name, `t${t}`]]), sets: new Map() });
    expect(await add(10, { tagIds: tags.slice(0, 8) })).toMatchObject({ ok: true, value: { tagIds: tags.slice(0, 8).sort() } });
    expect(await add(11, { tagIds: tags })).toMatchObject({ ok: false, error: { code: 'too_many_tags' } });
    expect(await add(12, { tagIds: [id(250)] })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('only income can be a refund', async () => {
    expect(await add(10, { isRefund: true })).toMatchObject({ ok: false, error: { code: 'refund_must_be_income' } });
    expect((await add(11, { isRefund: true, direction: 'income', amountMinor: 450n })).ok).toBe(true);
  });

  it('refuses a second transaction with the same id', async () => {
    await add(10);
    expect(await add(10)).toMatchObject({ ok: false, error: { code: 'transaction_exists' } });
  });

  it('is refused for a viewer', async () => {
    h.setRole('viewer');
    expect(await add(10)).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('derives the local date from its own offset, regardless of the device zone', async () => {
    const r = await add(10, { occurredUtcMs: Date.UTC(2026, 2, 1, 23, 30), tzOffsetMin: 120 });
    expect(r).toMatchObject({ ok: true, value: { localDate: 20_260_302 } });
  });
});

describe('updateTransaction', () => {
  beforeEach(async () => {
    await add(10);
  });

  it('changes the amount, and the balance follows', async () => {
    const r = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { amountMinor: -1_000n } });
    expect(r).toMatchObject({ ok: true, value: { amountMinor: -1_000n, baseAmountMinor: -1_000n } });
    expect(await balance()).toBe(9_000n);
  });

  it('turning an expense into income needs a matching sign', async () => {
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { direction: 'income' } })).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
    const ok = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { direction: 'income', amountMinor: 450n } });
    expect(ok.ok).toBe(true);
    expect(await balance()).toBe(10_450n);
  });

  it('moves the date and recomputes the local date', async () => {
    const r = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { occurredUtcMs: Date.UTC(2026, 3, 9, 8), tzOffsetMin: 0 } });
    expect(r).toMatchObject({ ok: true, value: { localDate: 20_260_409 } });
  });

  it('edits note, place, payee, pin and refund independently of the amount', async () => {
    const r = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { note: 'lunch', isPinned: true, place: { name: 'Cafe', latE7: 1, lonE7: 2 } } });
    expect(r).toMatchObject({ ok: true, value: { note: 'lunch', isPinned: true, place: { name: 'Cafe', latE7: 1, lonE7: 2 }, amountMinor: -450n } });
  });

  it('replaces the tags', async () => {
    for (const t of [200, 201, 202]) await h.replica.writePath.submit({ fold: h.fold, rec: id(t), table: TABLE.tag, fields: new Map([[LABEL_FIELD.name, `t${t}`]]), sets: new Map() });
    await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { tagIds: [id(200), id(201)] } });
    await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { tagIds: [id(201), id(202)] } });
    expect((await h.ledger()).transactions.get(id(10))!.tagIds).toEqual([id(201), id(202)]);
  });

  it('follows the status rules: Pending to Posted to Void, and Void back to Posted', async () => {
    const set = (status: 'pending' | 'posted' | 'void') => h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { status } });
    expect((await set('void')).ok).toBe(true);
    expect(await balance()).toBe(10_000n);
    expect((await set('posted')).ok).toBe(true);
    expect(await balance()).toBe(9_550n);
    expect(await set('pending')).toMatchObject({ ok: false, error: { code: 'invalid_status_change' } });
  });

  it('reports an unknown or deleted transaction', async () => {
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(99), changes: { note: 'x' } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await h.run(txns().deleteTransaction, { fold: h.fold, id: id(10) });
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { note: 'x' } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('shows when and on which device it was last changed', async () => {
    h.setNow(1_800_000_500_000);
    await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { note: 'later' } });
    const state = await h.replica.projections.getRecord(h.fold, id(10));
    const { lastChanged } = await import('../domain/records');
    expect(lastChanged(state!)).toEqual({ dev: id(0xa), atMs: 1_800_000_500_000 });
  });
});

describe('deleteTransaction and restoreTransaction', () => {
  beforeEach(async () => {
    await add(10);
  });

  it('removes it from the balance and lists, keeps it in Recently deleted, and restores it', async () => {
    await h.run(txns().deleteTransaction, { fold: h.fold, id: id(10) });
    let ledger = await h.ledger();
    expect(ledger.transactions.has(id(10))).toBe(false);
    expect(ledger.deleted.has(id(10))).toBe(true);
    expect(await balance()).toBe(10_000n);

    expect((await h.run(txns().restoreTransaction, { fold: h.fold, id: id(10) })).ok).toBe(true);
    ledger = await h.ledger();
    expect(ledger.transactions.has(id(10))).toBe(true);
    expect(await balance()).toBe(9_550n);
  });

  it('restores within 30 days and not after', async () => {
    const t0 = 1_800_000_000_000;
    h.setNow(t0);
    await h.run(txns().deleteTransaction, { fold: h.fold, id: id(10) });
    h.setNow(t0 + RETENTION_MS - 1);
    expect((await h.run(txns().restoreTransaction, { fold: h.fold, id: id(10) })).ok).toBe(true);
    await h.run(txns().deleteTransaction, { fold: h.fold, id: id(10) });
    h.setNow(t0 + 2 * RETENTION_MS);
    expect(await h.run(txns().restoreTransaction, { fold: h.fold, id: id(10) })).toMatchObject({ ok: false, error: { code: 'retention_expired' } });
  });

  it('cannot restore what is not deleted or does not exist', async () => {
    expect(await h.run(txns().restoreTransaction, { fold: h.fold, id: id(10) })).toMatchObject({ ok: false, error: { code: 'not_deleted' } });
    expect(await h.run(txns().restoreTransaction, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
