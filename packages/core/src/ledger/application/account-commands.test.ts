import { beforeEach, describe, expect, it } from 'vitest';
import { id, ledgerHarness, date, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createTransactionCommands } from './transaction-commands';

const accounts = createAccountCommands();
let h: LedgerHarness;
const txns = () => createTransactionCommands({ clock: { nowMs: () => h.clock.now } });

const newAccount = (n: number, over: Record<string, unknown> = {}) => ({
  fold: h.fold, id: id(n), kind: 'checking' as const, name: `Account ${n}`, currency: 'USD', openingBalanceMinor: 1_000n, openingDate: date(2026, 1, 1), ...over,
});

beforeEach(async () => {
  h = await ledgerHarness();
});

describe('createAccountRecord', () => {
  it('creates an account that shows in the ledger with its opening balance', async () => {
    const r = await h.run(accounts.createAccountRecord, newAccount(1));
    expect(r.ok).toBe(true);
    const ledger = await h.ledger();
    expect(ledger.accounts.get(id(1))).toMatchObject({ name: 'Account 1', currency: 'USD', openingBalanceMinor: 1_000n, archived: false, includeInNetWorth: true });
  });

  it('orders new accounts after the existing ones', async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    await h.run(accounts.createAccountRecord, newAccount(2));
    const ledger = await h.ledger();
    expect(ledger.accounts.get(id(2))!.sortOrder).toBeGreaterThan(ledger.accounts.get(id(1))!.sortOrder);
  });

  it('rejects an invalid account with a typed error and writes nothing', async () => {
    const r = await h.run(accounts.createAccountRecord, newAccount(1, { name: '' }));
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_account_name' } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(1); // only the Fold settings op
  });

  it('refuses a second account with the same id', async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    expect(await h.run(accounts.createAccountRecord, newAccount(1))).toMatchObject({ ok: false, error: { code: 'account_exists' } });
  });

  it('is an editor action: a viewer is refused', async () => {
    h.setRole('viewer');
    expect(await h.run(accounts.createAccountRecord, newAccount(1))).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('emits a created event', async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    expect(h.events.some((e) => e.type === 'RecordCreated' && e.rec === id(1))).toBe(true);
  });
});

describe('updateAccount', () => {
  beforeEach(async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
  });

  it('renames an account and writes only the changed field', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect((await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { name: 'Everyday' } })).ok).toBe(true);
    expect((await h.ledger()).accounts.get(id(1))!.name).toBe('Everyday');
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before + 1);
  });

  it('writes nothing when nothing changed', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { name: 'Account 1' } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
  });

  it('changes the currency while there are no entries, then locks it', async () => {
    h = await ledgerHarness({ baseCurrency: 'EUR' }); // so that EUR entries need no exchange rate
    await h.run(accounts.createAccountRecord, newAccount(1));
    expect((await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { currency: 'EUR' } })).ok).toBe(true);
    const add = await h.run(txns().addTransaction, { fold: h.fold, id: id(50), accountId: id(1), direction: 'income', amountMinor: 5n, currency: 'EUR', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 });
    expect(add.ok).toBe(true);
    expect(await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { currency: 'USD' } })).toMatchObject({ ok: false, error: { code: 'currency_locked' } });
  });

  it('keeps the currency locked even when the only entry is in Recently deleted', async () => {
    await h.run(txns().addTransaction, { fold: h.fold, id: id(50), accountId: id(1), direction: 'income', amountMinor: 5n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 });
    await h.run(txns().deleteTransaction, { fold: h.fold, id: id(50) });
    expect(await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { currency: 'EUR' } })).toMatchObject({ ok: false, error: { code: 'currency_locked' } });
  });

  it('refuses an opening date later than an existing entry', async () => {
    await h.run(txns().addTransaction, { fold: h.fold, id: id(50), accountId: id(1), direction: 'income', amountMinor: 5n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 });
    expect(await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { openingDate: date(2026, 6, 1) } })).toMatchObject({ ok: false, error: { code: 'opening_date_after_entries' } });
  });

  it('reports an unknown account', async () => {
    expect(await h.run(accounts.updateAccount, { fold: h.fold, id: id(99), changes: { name: 'x' } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('archiveAccount', () => {
  it('archives and un-archives, and an archived account takes no new entries', async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(1), archived: true });
    expect((await h.ledger()).accounts.get(id(1))!.archived).toBe(true);
    const add = await h.run(txns().addTransaction, { fold: h.fold, id: id(50), accountId: id(1), direction: 'income', amountMinor: 5n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 });
    expect(add).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(1), archived: false });
    expect((await h.run(txns().addTransaction, { fold: h.fold, id: id(50), accountId: id(1), direction: 'income', amountMinor: 5n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 })).ok).toBe(true);
  });

  it('excluding from net worth is an ordinary update', async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    await h.run(accounts.updateAccount, { fold: h.fold, id: id(1), changes: { includeInNetWorth: false } });
    expect((await h.ledger()).accounts.get(id(1))!.includeInNetWorth).toBe(false);
  });
});

describe('groups', () => {
  beforeEach(async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    await h.run(accounts.createAccountRecord, newAccount(2));
    await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(70), name: 'Cash and bank' });
  });

  it('puts accounts in a group and takes them out', async () => {
    await h.run(accounts.groupAccounts, { fold: h.fold, group: id(70), accounts: [id(1), id(2)], member: true });
    expect((await h.ledger()).accounts.get(id(1))!.groupIds).toEqual([id(70)]);
    await h.run(accounts.groupAccounts, { fold: h.fold, group: id(70), accounts: [id(1)], member: false });
    const ledger = await h.ledger();
    expect(ledger.accounts.get(id(1))!.groupIds).toEqual([]);
    expect(ledger.accounts.get(id(2))!.groupIds).toEqual([id(70)]);
  });

  it('deleting a group only ungroups', async () => {
    await h.run(accounts.groupAccounts, { fold: h.fold, group: id(70), accounts: [id(1)], member: true });
    await h.run(accounts.deleteAccountGroup, { fold: h.fold, id: id(70) });
    const ledger = await h.ledger();
    expect(ledger.groups.size).toBe(0);
    expect(ledger.accounts.get(id(1))!.groupIds).toEqual([]);
    expect(ledger.accounts.has(id(1))).toBe(true);
  });

  it('validates the group name and that the group exists', async () => {
    expect(await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(71), name: '  ' })).toMatchObject({ ok: false, error: { code: 'invalid_group_name' } });
    expect(await h.run(accounts.groupAccounts, { fold: h.fold, group: id(99), accounts: [id(1)], member: true })).toMatchObject({ ok: false, error: { code: 'unknown_group' } });
  });

  it('renames and orders a group', async () => {
    await h.run(accounts.updateAccountGroup, { fold: h.fold, id: id(70), name: 'Banks', sortOrder: 5 });
    expect((await h.ledger()).groups.get(id(70))).toMatchObject({ name: 'Banks', sortOrder: 5 });
  });
});

describe('deleteLedgerAccount', () => {
  beforeEach(async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    await h.run(accounts.createAccountRecord, newAccount(2));
    for (const n of [50, 51]) {
      await h.run(txns().addTransaction, { fold: h.fold, id: id(n), accountId: id(1), direction: 'income', amountMinor: 5n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 });
    }
    await h.run(txns().addTransaction, { fold: h.fold, id: id(52), accountId: id(2), direction: 'income', amountMinor: 7n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1), tzOffsetMin: 0 });
  });

  it('states what will be removed before anything is deleted', async () => {
    const r = await h.ask(accounts.describeAccountDeletion, { fold: h.fold, id: id(1) });
    expect(r).toEqual({ ok: true, value: { accountName: 'Account 1', transactions: 2, transfers: 0 } });
  });

  it('needs explicit confirmation', async () => {
    expect(await h.run(accounts.deleteLedgerAccount, { fold: h.fold, id: id(1), confirm: false })).toMatchObject({ ok: false, error: { code: 'confirmation_required' } });
    expect((await h.ledger()).accounts.has(id(1))).toBe(true);
  });

  it('removes the account and its transactions together, leaving other accounts alone', async () => {
    const r = await h.run(accounts.deleteLedgerAccount, { fold: h.fold, id: id(1), confirm: true });
    expect(r).toEqual({ ok: true, value: { accountName: 'Account 1', transactions: 2, transfers: 0 } });
    const ledger = await h.ledger();
    expect(ledger.accounts.has(id(1))).toBe(false);
    expect([...ledger.transactions.keys()]).toEqual([id(52)]);
  });
});
