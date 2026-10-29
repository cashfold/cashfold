import { beforeEach, describe, expect, it } from 'vitest';
import { id, ledgerHarness, date, type LedgerHarness } from '../../testing/index';
import type { FieldValue } from '../../sync/domain/merge';
import { GROUP_FIELD, TABLE } from '../domain/tables';
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

describe('moveAccountToGroup', () => {
  beforeEach(async () => {
    await h.run(accounts.createAccountRecord, newAccount(1));
    await h.run(accounts.createAccountRecord, newAccount(2));
    await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(70), name: 'Cash' });
    await h.run(accounts.createAccountGroup, { fold: h.fold, id: id(71), name: 'Savings' });
  });
  const groupsOf = async (n: number) => (await h.ledger()).accounts.get(id(n))!.groupIds;

  it('puts an account with no group into the group, exactly', async () => {
    expect((await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(70) })).ok).toBe(true);
    expect(await groupsOf(1)).toEqual([id(70)]);
  });

  it('takes it out of the first group when it moves to another', async () => {
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(70) });
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(71) });
    expect(await groupsOf(1)).toEqual([id(71)]);
    expect(await groupsOf(2)).toEqual([]);
  });

  it('empties the groups for null', async () => {
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(70) });
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: null });
    expect(await groupsOf(1)).toEqual([]);
  });

  it('leaves an account that was in two groups in exactly one', async () => {
    await h.run(accounts.groupAccounts, { fold: h.fold, group: id(70), accounts: [id(1)], member: true });
    await h.run(accounts.groupAccounts, { fold: h.fold, group: id(71), accounts: [id(1)], member: true });
    expect(await groupsOf(1)).toHaveLength(2);
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(71) });
    expect(await groupsOf(1)).toEqual([id(71)]);
  });

  it('is one submitted write, not two', async () => {
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(70) });
    const before = (await h.replica.oplog.list(h.fold)).length;
    await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(71) });
    expect((await h.replica.oplog.list(h.fold)).length - before).toBe(1);
  });

  it('refuses an unknown or deleted group, and an unknown account, writing nothing', async () => {
    await h.run(accounts.deleteAccountGroup, { fold: h.fold, id: id(71) });
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect(await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(99) })).toMatchObject({ ok: false, error: { code: 'unknown_group' } });
    expect(await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(71) })).toMatchObject({ ok: false, error: { code: 'unknown_group' } });
    expect(await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(98), group: id(70) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect((await h.replica.oplog.list(h.fold)).length).toBe(before);
  });

  it('is an editor action: a viewer is refused', async () => {
    h.setRole('viewer');
    expect(await h.run(accounts.moveAccountToGroup, { fold: h.fold, account: id(1), group: id(70) })).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });
});

describe('group names', () => {
  const create = (n: number, name: string) => h.run(accounts.createAccountGroup, { fold: h.fold, id: id(n), name });
  const rename = (n: number, name: string) => h.run(accounts.updateAccountGroup, { fold: h.fold, id: id(n), name });
  const count = async () => (await h.replica.oplog.list(h.fold)).length;

  it('refuses a name another live group has, ignoring case, accents and surrounding spaces, and writes nothing', async () => {
    await create(70, 'Household');
    await create(71, 'Café');
    const before = await count();
    for (const name of ['  household ', 'Household', 'HOUSEHOLD', 'Cafe']) {
      expect(await create(72, name), name).toMatchObject({ ok: false, error: { code: 'group_name_taken' } });
    }
    expect(await count()).toBe(before);
  });

  it('refuses names in Cyrillic and Polish that differ only by case, and accepts ones that differ in letters', async () => {
    await create(70, 'Заощадження');
    await create(71, 'Oszczędności');
    expect(await create(72, 'заощадження')).toMatchObject({ ok: false, error: { code: 'group_name_taken' } });
    expect(await create(73, 'oszczędności')).toMatchObject({ ok: false, error: { code: 'group_name_taken' } });
    expect((await create(74, 'Заощадженн')).ok).toBe(true);
    expect((await create(75, 'Oszczednosc')).ok).toBe(true);
  });

  it('accepts a free name of 1 to 80 characters and still refuses an empty or 81-character name', async () => {
    expect((await create(70, 'x')).ok).toBe(true);
    expect((await create(71, 'y'.repeat(80))).ok).toBe(true);
    expect(await create(72, '')).toMatchObject({ ok: false, error: { code: 'invalid_group_name' } });
    expect(await create(73, 'z'.repeat(81))).toMatchObject({ ok: false, error: { code: 'invalid_group_name' } });
  });

  it('refuses renaming to another group\'s name', async () => {
    await create(70, 'One');
    await create(71, 'Two');
    expect(await rename(71, ' one')).toMatchObject({ ok: false, error: { code: 'group_name_taken' } });
  });

  it('allows renaming a group to its own name, in another case or with extra spaces', async () => {
    await create(70, 'Household');
    for (const name of ['Household', 'household', '  Household  ', 'HOUSEHOLD']) expect((await rename(70, name)).ok, name).toBe(true);
    expect((await h.ledger()).groups.get(id(70))!.name).toBe('HOUSEHOLD');
  });

  it('frees the name of a deleted group', async () => {
    await create(70, 'Old');
    await h.run(accounts.deleteAccountGroup, { fold: h.fold, id: id(70) });
    expect((await create(71, 'old')).ok).toBe(true);
  });

  it('leaves groups that already share a name alone: both can be renamed away, and one may keep the shared name only as itself', async () => {
    // Old data: write two groups with one name straight to the records, as earlier versions allowed.
    const dup = (n: number) => h.replica.writePath.submit({ fold: h.fold, rec: id(n), table: TABLE.accountGroup, fields: new Map<number, FieldValue>([[GROUP_FIELD.name, 'Twin'], [GROUP_FIELD.icon, null], [GROUP_FIELD.color, 0n], [GROUP_FIELD.sortOrder, BigInt(n)]]), sets: new Map() });
    await dup(70);
    await dup(71);
    expect(await rename(70, 'Twin')).toMatchObject({ ok: false, error: { code: 'group_name_taken' } });
    expect((await rename(70, 'First')).ok).toBe(true);
    expect((await rename(71, 'Second')).ok).toBe(true);
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
