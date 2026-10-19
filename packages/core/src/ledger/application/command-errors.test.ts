import { beforeEach, describe, expect, it } from 'vitest';
import { TABLE } from '../domain/tables';
import { transferFieldPatch } from '../domain/transfer';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createAdjustBalance } from './adjust-balance';
import { createCategoryCommands, createLabelCommands, labelUsage, sameLabel } from './category-commands';
import { createRateCommands } from './rate-commands';
import { createRevalue } from './revalue';
import { createTransactionCommands } from './transaction-commands';

const accounts = createAccountCommands();
const categories = createCategoryCommands();
const labels = createLabelCommands();
const rates = createRateCommands();
let h: LedgerHarness;
const clock = { nowMs: () => h.clock.now };
const txns = () => createTransactionCommands({ clock });
const MARCH = Date.UTC(2026, 2, 1, 12);
const E12 = 10n ** 12n;

const account = (n: number, over: Record<string, unknown> = {}) => h.run(accounts.createAccountRecord, {
  fold: h.fold, id: id(n), kind: 'checking' as const, name: `A${n}`, currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1), ...over,
});
const add = (n: number, over: Record<string, unknown> = {}) => h.run(txns().addTransaction, {
  fold: h.fold, id: id(n), accountId: id(1), direction: 'expense' as const, amountMinor: -100n, currency: 'USD', occurredUtcMs: MARCH, tzOffsetMin: 0, ...over,
});

beforeEach(async () => {
  h = await ledgerHarness();
  await account(1);
});

describe('account commands: errors and no-ops', () => {
  it('takes an explicit sort order', async () => {
    await account(2, { sortOrder: 7 });
    expect((await h.ledger()).accounts.get(id(2))!.sortOrder).toBe(7);
  });

  it('archiving an unknown account fails, and archiving to the same state writes nothing', async () => {
    expect(await h.run(accounts.archiveAccount, { fold: h.fold, id: id(99), archived: true })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const before = (await h.replica.oplog.list(h.fold)).length;
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(1), archived: false });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
  });

  it('groups: duplicate ids, unknown groups, bad names, partial updates and no-ops', async () => {
    await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(70), name: 'Banks' });
    expect(await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(70), name: 'Again' })).toMatchObject({ ok: false, error: { code: 'group_exists' } });
    expect(await h.run(accounts.updateAccountGroup, { fold: h.fold, id: id(99), name: 'x' })).toMatchObject({ ok: false, error: { code: 'unknown_group' } });
    expect(await h.run(accounts.updateAccountGroup, { fold: h.fold, id: id(70), name: '' })).toMatchObject({ ok: false, error: { code: 'invalid_group_name' } });
    expect(await h.run(accounts.deleteAccountGroup, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'unknown_group' } });
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect((await h.run(accounts.updateAccountGroup, { fold: h.fold, id: id(70) })).ok).toBe(true);
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
    await h.run(accounts.updateAccountGroup, { fold: h.fold, id: id(70), icon: 'bank', color: 4 });
    expect((await h.ledger()).groups.get(id(70))).toMatchObject({ icon: 'bank', color: 4, name: 'Banks' });
  });

  it('putting an unknown account in a group fails, and an empty list does nothing', async () => {
    await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(70), name: 'Banks' });
    expect(await h.run(accounts.groupAccounts, { fold: h.fold, group: id(70), accounts: [id(99)], member: true })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect((await h.run(accounts.groupAccounts, { fold: h.fold, group: id(70), accounts: [], member: true })).ok).toBe(true);
  });

  it('deleting an unknown account fails and describing one says nothing', async () => {
    expect(await h.run(accounts.deleteLedgerAccount, { fold: h.fold, id: id(99), confirm: true })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.ask(accounts.describeAccountDeletion, { fold: h.fold, id: id(99) })).toEqual({ ok: true, value: undefined });
  });

  it('deleting an account also removes the transfers that involve it', async () => {
    await account(2);
    await add(10);
    for (const [n, from, to] of [[20, id(1), id(2)], [21, id(2), id(1)], [22, id(2), id(2)]] as const) {
      await h.replica.writePath.submit({ fold: h.fold, rec: id(n), table: TABLE.transfer, sets: new Map(), fields: transferFieldPatch({ fromAccountId: from, toAccountId: to, fromAmountMinor: 1n, toAmountMinor: 1n, fxRateId: null }) });
    }
    expect(await h.ask(accounts.describeAccountDeletion, { fold: h.fold, id: id(1) })).toEqual({ ok: true, value: { accountName: 'A1', transactions: 1, transfers: 2 } });
    await h.run(accounts.deleteLedgerAccount, { fold: h.fold, id: id(1), confirm: true });
    const records = await h.replica.projections.listRecords(h.fold);
    expect(records.get(id(20))!.fields.get(0xffff)!.value).toBe(true);
    expect(records.get(id(21))!.fields.get(0xffff)!.value).toBe(true);
    expect(records.get(id(22))!.fields.get(0xffff)).toBeUndefined(); // between other accounts: untouched
  });
});

describe('category and label commands: errors and no-ops', () => {
  beforeEach(async () => {
    await h.run(categories.createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Food' });
    await h.run(labels.createPayee, { fold: h.fold, id: id(80), name: 'Cafe' });
    await h.run(labels.createTag, { fold: h.fold, id: id(90), name: 'fun' });
  });

  it('refuses duplicate ids and unknown targets', async () => {
    expect(await h.run(categories.createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Again' })).toMatchObject({ ok: false, error: { code: 'category_exists' } });
    expect(await h.run(categories.updateCategory, { fold: h.fold, id: id(99), changes: { name: 'x' } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.run(categories.deleteCategory, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(99), into: id(60) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(60), into: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.run(labels.createPayee, { fold: h.fold, id: id(80), name: 'Again' })).toMatchObject({ ok: false, error: { code: 'label_exists' } });
    expect(await h.run(labels.mergePayees, { fold: h.fold, from: id(99), into: id(80) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.run(labels.deleteTag, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('updating with nothing to change writes nothing, and a bad name is refused', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect((await h.run(categories.updateCategory, { fold: h.fold, id: id(60), changes: {} })).ok).toBe(true);
    expect((await h.run(labels.updateTag, { fold: h.fold, id: id(90) })).ok).toBe(true);
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
    expect(await h.run(labels.updateTag, { fold: h.fold, id: id(90), name: ' ' })).toMatchObject({ ok: false, error: { code: 'invalid_label_name' } });
    expect(await h.run(labels.updatePayee, { fold: h.fold, id: id(99), name: 'x' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('counts category and payee usage', async () => {
    await add(10, { categoryId: id(60), payeeId: id(80) });
    const r = await h.ask(labelUsage, { fold: h.fold });
    expect(r.ok && [r.value.categories.get(id(60)), r.value.payees.get(id(80))]).toEqual([1, 1]);
  });

  it('recognises look-alike names', () => {
    expect(sameLabel('Café', 'cafe')).toBe(true);
    expect(sameLabel('Cafe', 'Bar')).toBe(false);
  });

  it('merging categories with no transactions and no children just removes the source', async () => {
    await h.run(categories.createCategory, { fold: h.fold, id: id(61), direction: 'expense', parentId: null, name: 'Other' });
    expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(61), into: id(60) })).toEqual({ ok: true, value: { reassigned: 0 } });
  });
});

describe('transaction commands: the less common paths', () => {
  beforeEach(async () => {
    await account(2, { name: 'Second' });
    await h.run(categories.createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Food' });
    await h.run(categories.createCategory, { fold: h.fold, id: id(61), direction: 'income', parentId: null, name: 'Pay' });
    await h.run(labels.createPayee, { fold: h.fold, id: id(80), name: 'Cafe' });
    await add(10);
  });

  it('refuses an unknown payee', async () => {
    expect(await add(11, { payeeId: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('moves a transaction to another account, which must accept it', async () => {
    expect((await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { accountId: id(2) } })).ok).toBe(true);
    expect((await h.ledger()).transactions.get(id(10))!.accountId).toBe(id(2));
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(1), archived: true });
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { accountId: id(1) } })).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { accountId: id(99) } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('changes the category, payee, refund and attachment, and checks them', async () => {
    const r = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { categoryId: id(60), payeeId: id(80), attachmentRef: id(55) } });
    expect(r).toMatchObject({ ok: true, value: { categoryId: id(60), payeeId: id(80), attachmentRef: id(55) } });
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { categoryId: id(61) } })).toMatchObject({ ok: false, error: { code: 'category_direction_mismatch' } });
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { isRefund: true } })).toMatchObject({ ok: false, error: { code: 'refund_must_be_income' } });
    const cleared = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { categoryId: null, payeeId: null } });
    expect(cleared).toMatchObject({ ok: true, value: { categoryId: null, payeeId: null } });
    const refund = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { direction: 'income', amountMinor: 100n, isRefund: true, status: 'posted' } });
    expect(refund).toMatchObject({ ok: true, value: { isRefund: true, direction: 'income' } });
  });

  it('a change that needs an exchange rate it does not have is refused', async () => {
    await account(3, { currency: 'EUR' });
    expect(await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: { accountId: id(3), currency: 'EUR' } })).toMatchObject({ ok: false, error: { code: 'rate_required', currency: 'EUR' } });
  });

  it('an edit that changes nothing writes nothing and returns the transaction', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    const r = await h.run(txns().updateTransaction, { fold: h.fold, id: id(10), changes: {} });
    expect(r).toMatchObject({ ok: true, value: { id: id(10) } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
  });

  it('restoring needs the account to still exist', async () => {
    await h.run(txns().deleteTransaction, { fold: h.fold, id: id(10) });
    await h.run(accounts.deleteLedgerAccount, { fold: h.fold, id: id(1), confirm: true });
    expect(await h.run(txns().restoreTransaction, { fold: h.fold, id: id(10) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.run(txns().deleteTransaction, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('an amount outside 64 bits cannot be snapshotted', async () => {
    expect(await add(12, { amountMinor: -(2n ** 63n) - 1n })).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });
});

describe('a Fold with no settings record', () => {
  it('treats the account currency as the base, so nothing needs a rate', async () => {
    h = await ledgerHarness({ noSettings: true });
    await account(1, { currency: 'EUR' });
    const r = await add(10, { currency: 'EUR' });
    expect(r).toMatchObject({ ok: true, value: { baseCurrency: 'EUR', baseAmountMinor: -100n } });
  });
});

describe('adjust balance, rates and revalue: edges', () => {
  it('adjusting an account with an out-of-range target is refused', async () => {
    const adjust = createAdjustBalance({ clock }).adjustBalance;
    expect(await h.run(adjust, { fold: h.fold, id: id(20), accountId: id(1), target: 2n ** 63n, date: date(2026, 3, 1) })).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });

  it('revalue ignores ids it does not know and Folds without a base currency', async () => {
    const revalue = createRevalue({ clock }).revalue;
    expect(await h.run(revalue, { fold: h.fold, ids: [id(99)] })).toEqual({ ok: true, value: { revalued: 0, unchanged: 0, missingRates: [] } });
    h = await ledgerHarness({ noSettings: true });
    await account(1);
    await add(10);
    expect(await h.run(createRevalue({ clock }).revalue, { fold: h.fold, ids: [id(10)] })).toEqual({ ok: true, value: { revalued: 0, unchanged: 0, missingRates: [] } });
  });

  it('revalue skips what cannot be converted exactly', async () => {
    await account(2, { currency: 'EUR', openingDate: date(1970, 1, 1) });
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: 100, rateE12: E12 });
    await add(11, { accountId: id(2), currency: 'EUR', occurredUtcMs: 150_000, amountMinor: -(2n ** 62n) });
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(31), quote: 'EUR', asOfUtcS: 200, rateE12: 1n }); // a rate this small makes the converted amount overflow
    const r = await h.run(createRevalue({ clock: { nowMs: () => 300_000 } }).revalue, { fold: h.fold, ids: [id(11)] });
    expect(r).toEqual({ ok: true, value: { revalued: 0, unchanged: 0, missingRates: [] } });
  });
});
