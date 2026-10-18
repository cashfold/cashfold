import { describe, expect, it } from 'vitest';
import type { CommandDef } from '../../sync/application/buses';
import type { DomainError } from '../../shared-kernel/result';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createAdjustBalance } from './adjust-balance';
import { createCategoryCommands, createLabelCommands } from './category-commands';
import { createRateCommands } from './rate-commands';
import { createRevalue } from './revalue';
import { createTransactionCommands } from './transaction-commands';

// When storing fails (here: this device has lost the Fold's key), every command must report a typed error, leave
// the ledger exactly as it was, and never claim success.

const E12 = 10n ** 12n;
const MARCH = Date.UTC(2026, 2, 1, 12);

async function prepared(): Promise<{ h: LedgerHarness; cases: Array<[string, () => Promise<{ ok: boolean; error?: DomainError }>]> }> {
  const h = await ledgerHarness();
  const clock = { nowMs: () => h.clock.now };
  const accounts = createAccountCommands();
  const categories = createCategoryCommands();
  const labels = createLabelCommands();
  const txns = createTransactionCommands({ clock });
  const rates = createRateCommands();
  const run = <C, R, E extends DomainError>(def: CommandDef<C, R, E>, c: C) => h.run(def, c);
  const f = h.fold;

  await run(accounts.createAccountRecord, { fold: f, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 1_000n, openingDate: date(2026, 1, 1) });
  await run(accounts.createAccountRecord, { fold: f, id: id(2), kind: 'checking', name: 'Euro', currency: 'EUR', openingBalanceMinor: 0n, openingDate: date(1970, 1, 1) });
  await run(accounts.createAccountGroup, { fold: f, id: id(70), name: 'Banks' });
  await run(accounts.groupAccounts, { fold: f, group: id(70), accounts: [id(1)], member: true });
  for (const [n, parent] of [[60, null], [61, id(60)], [62, null], [63, null]] as const) {
    await run(categories.createCategory, { fold: f, id: id(n), direction: 'expense', parentId: parent, name: `C${n}` });
  }
  for (const n of [80, 81]) await run(labels.createPayee, { fold: f, id: id(n), name: `P${n}` });
  for (const n of [90, 91]) await run(labels.createTag, { fold: f, id: id(n), name: `T${n}` });
  await run(rates.setCustomRate, { fold: f, id: id(30), quote: 'EUR', asOfUtcS: 100, rateE12: E12 });
  const base = { fold: f, accountId: id(1), direction: 'expense' as const, amountMinor: -100n, currency: 'USD', occurredUtcMs: MARCH, tzOffsetMin: 0 };
  await run(txns.addTransaction, { ...base, id: id(10), categoryId: id(60), payeeId: id(80), tagIds: [id(90)] });
  await run(txns.addTransaction, { ...base, id: id(11) });
  await run(txns.deleteTransaction, { fold: f, id: id(11) });
  await run(txns.addTransaction, { ...base, id: id(12), accountId: id(2), currency: 'EUR', occurredUtcMs: 150_000 });
  await run(rates.setCustomRate, { fold: f, id: id(31), quote: 'EUR', asOfUtcS: 200, rateE12: 2n * E12 });

  const before = (await h.replica.oplog.list(f)).length;
  h.world.dropFold(f);

  const adjust = createAdjustBalance({ clock }).adjustBalance;
  const revalue = createRevalue({ clock: { nowMs: () => 300_000 } }).revalue;
  const cases: Array<[string, () => Promise<{ ok: boolean; error?: DomainError }>]> = [
    ['createAccountRecord', () => run(accounts.createAccountRecord, { fold: f, id: id(5), kind: 'cash', name: 'Wallet', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) })],
    ['updateAccount', () => run(accounts.updateAccount, { fold: f, id: id(1), changes: { name: 'Renamed' } })],
    ['archiveAccount', () => run(accounts.archiveAccount, { fold: f, id: id(1), archived: true })],
    ['createAccountGroup', () => run(accounts.createAccountGroup, { fold: f, id: id(71), name: 'More' })],
    ['updateAccountGroup', () => run(accounts.updateAccountGroup, { fold: f, id: id(70), name: 'Renamed', icon: 'bank', color: 2, sortOrder: 3 })],
    ['deleteAccountGroup', () => run(accounts.deleteAccountGroup, { fold: f, id: id(70) })],
    ['groupAccounts add', () => run(accounts.groupAccounts, { fold: f, group: id(70), accounts: [id(2)], member: true })],
    ['groupAccounts remove', () => run(accounts.groupAccounts, { fold: f, group: id(70), accounts: [id(1)], member: false })],
    ['deleteLedgerAccount', () => run(accounts.deleteLedgerAccount, { fold: f, id: id(1), confirm: true })],
    ['createCategory', () => run(categories.createCategory, { fold: f, id: id(64), direction: 'expense', parentId: null, name: 'New' })],
    ['seedDefaultCategories', () => run(categories.seedDefaultCategories, { fold: f })],
    ['updateCategory', () => run(categories.updateCategory, { fold: f, id: id(60), changes: { name: 'Renamed' } })],
    ['moveCategory', () => run(categories.moveCategory, { fold: f, id: id(61), parentId: id(62) })],
    ['deleteCategory', () => run(categories.deleteCategory, { fold: f, id: id(63) })],
    ['mergeCategories', () => run(categories.mergeCategories, { fold: f, from: id(60), into: id(62) })],
    ['createPayee', () => run(labels.createPayee, { fold: f, id: id(82), name: 'New' })],
    ['updatePayee', () => run(labels.updatePayee, { fold: f, id: id(80), name: 'Renamed', color: 1 })],
    ['deletePayee', () => run(labels.deletePayee, { fold: f, id: id(80) })],
    ['mergePayees', () => run(labels.mergePayees, { fold: f, from: id(80), into: id(81) })],
    ['createTag', () => run(labels.createTag, { fold: f, id: id(92), name: 'New' })],
    ['updateTag', () => run(labels.updateTag, { fold: f, id: id(90), name: 'Renamed' })],
    ['deleteTag', () => run(labels.deleteTag, { fold: f, id: id(90) })],
    ['mergeTags', () => run(labels.mergeTags, { fold: f, from: id(90), into: id(91) })],
    ['addTransaction', () => run(txns.addTransaction, { ...base, id: id(13) })],
    ['updateTransaction (amount)', () => run(txns.updateTransaction, { fold: f, id: id(10), changes: { amountMinor: -200n } })],
    ['updateTransaction (tags)', () => run(txns.updateTransaction, { fold: f, id: id(10), changes: { tagIds: [id(91)] } })],
    ['deleteTransaction', () => run(txns.deleteTransaction, { fold: f, id: id(10) })],
    ['restoreTransaction', () => run(txns.restoreTransaction, { fold: f, id: id(11) })],
    ['adjustBalance', () => run(adjust, { fold: f, id: id(14), accountId: id(1), target: 5n, date: date(2026, 3, 5) })],
    ['setCustomRate', () => run(rates.setCustomRate, { fold: f, id: id(32), quote: 'GBP', asOfUtcS: 100, rateE12: E12 })],
    ['setCustomRate (update)', () => run(rates.setCustomRate, { fold: f, id: id(33), quote: 'EUR', asOfUtcS: 100, rateE12: 3n * E12 })],
    ['deleteCustomRate', () => run(rates.deleteCustomRate, { fold: f, id: id(30) })],
    ['applyRateTable', () => run(rates.applyRateTable, { fold: f, asOfUtcS: 300, rates: [{ quote: 'JPY', rateE12: E12 }] })],
    ['revalue', () => run(revalue, { fold: f, ids: [id(12)] })],
  ];
  expect(before).toBeGreaterThan(0);
  return { h, cases };
}

describe('when storing fails', () => {
  it('every command reports a typed error and changes nothing', async () => {
    const { h, cases } = await prepared();
    const opsBefore = (await h.replica.oplog.list(h.fold)).length;
    const ledgerBefore = await h.ledger();
    for (const [name, call] of cases) {
      const result = await call();
      expect(result, name).toMatchObject({ ok: false, error: { code: 'no_key' } });
    }
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(opsBefore);
    const ledgerAfter = await h.ledger();
    expect([...ledgerAfter.transactions.keys()]).toEqual([...ledgerBefore.transactions.keys()]);
    expect([...ledgerAfter.accounts.values()].map((a) => a.name)).toEqual([...ledgerBefore.accounts.values()].map((a) => a.name));
  });
});
