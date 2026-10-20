import { beforeEach, describe, expect, it } from 'vitest';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { accountBalance } from './balance';
import { RETENTION_MS } from './transaction-commands';
import { createTransferCommands } from './transfer-commands';

const accounts = createAccountCommands();
let h: LedgerHarness;
const transfers = () => createTransferCommands({ clock: { nowMs: () => h.clock.now } });
const MARCH = Date.UTC(2026, 2, 1, 12);

const account = (n: number, over: Record<string, unknown> = {}) => h.run(accounts.createAccountRecord, {
  fold: h.fold, id: id(n), kind: 'checking' as const, name: `A${n}`, currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1), ...over,
});
const move = (n: number, over: Record<string, unknown> = {}) => h.run(transfers().addTransfer, {
  fold: h.fold, id: id(n), fromAccountId: id(1), toAccountId: id(2), fromAmountMinor: 10_000n, toAmountMinor: 10_000n, occurredUtcMs: MARCH, tzOffsetMin: 0, ...over,
});
const balance = async (n: number) => {
  const r = accountBalance(await h.ledger(), id(n));
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

beforeEach(async () => {
  h = await ledgerHarness();
  await account(1, { openingBalanceMinor: 100_000n });
  await account(2);
});

describe('addTransfer', () => {
  it('moves money between two accounts as one record', async () => {
    const r = await move(10);
    expect(r).toMatchObject({ ok: true, value: { id: id(10), fromAmountMinor: 10_000n, toAmountMinor: 10_000n, localDate: 20_260_301 } });
    expect([await balance(1), await balance(2)]).toEqual([90_000n, 10_000n]);
    const ops = (await h.replica.oplog.list(h.fold)).filter((o) => o.sealed.rec === id(10));
    expect(ops).toHaveLength(1);
  });

  it('USD 100.00 to EUR 91.37 keeps each side exactly as entered', async () => {
    await account(3, { currency: 'EUR' });
    await move(10, { toAccountId: id(3), toAmountMinor: 9_137n });
    expect([await balance(1), await balance(3)]).toEqual([90_000n, 9_137n]);
  });

  it('refuses the same account, bad amounts and mismatched same-currency amounts, and writes nothing', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect(await move(10, { toAccountId: id(1) })).toMatchObject({ ok: false, error: { code: 'same_account' } });
    expect(await move(10, { fromAmountMinor: 0n })).toMatchObject({ ok: false, error: { code: 'invalid_transfer_amount' } });
    expect(await move(10, { toAmountMinor: 9_999n })).toMatchObject({ ok: false, error: { code: 'amounts_must_match' } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
  });

  it('refuses unknown or archived accounts and duplicate ids', async () => {
    expect(await move(10, { toAccountId: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await move(10, { fromAccountId: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(2), archived: true });
    expect(await move(10)).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(2), archived: false });
    await move(10);
    expect(await move(10)).toMatchObject({ ok: false, error: { code: 'transfer_exists' } });
  });

  it('feeds a goal account, which takes transfers but not plain income', async () => {
    await account(3, { kind: 'goal' });
    expect((await move(10, { toAccountId: id(3), toAmountMinor: 10_000n })).ok).toBe(true);
    expect(await balance(3)).toBe(10_000n);
  });

  it('is an editor action', async () => {
    h.setRole('viewer');
    expect(await move(10)).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('can name the rate the amounts were based on, without it changing them', async () => {
    await account(3, { currency: 'EUR' });
    const r = await move(10, { toAccountId: id(3), toAmountMinor: 9_137n, fxRateId: id(55) });
    expect(r).toMatchObject({ ok: true, value: { fxRateId: id(55), toAmountMinor: 9_137n } });
  });
});

describe('updateTransfer', () => {
  beforeEach(async () => {
    await move(10);
  });

  it('changes both amounts together in one write', async () => {
    await account(3, { currency: 'EUR' });
    const before = (await h.replica.oplog.list(h.fold)).length;
    const r = await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { toAccountId: id(3), toAmountMinor: 9_137n } });
    expect(r).toMatchObject({ ok: true, value: { toAccountId: id(3), fromAmountMinor: 10_000n, toAmountMinor: 9_137n } });
    expect((await h.replica.oplog.list(h.fold)).length - before).toBe(1);
    expect([await balance(1), await balance(2), await balance(3)]).toEqual([90_000n, 0n, 9_137n]);
  });

  it('re-checks the rules against the result of the edit', async () => {
    expect(await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { toAmountMinor: 5n } })).toMatchObject({ ok: false, error: { code: 'amounts_must_match' } });
    expect(await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { toAccountId: id(1) } })).toMatchObject({ ok: false, error: { code: 'same_account' } });
    expect(await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { toAccountId: id(99) } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('edits note, time and status without touching the amounts', async () => {
    const before = (await h.replica.projections.getRecord(h.fold, id(10)))!.fields.get(3)!.opId;
    const r = await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { note: 'rent', occurredUtcMs: Date.UTC(2026, 3, 2, 8), tzOffsetMin: 0 } });
    expect(r).toMatchObject({ ok: true, value: { note: 'rent', localDate: 20_260_402 } });
    expect((await h.replica.projections.getRecord(h.fold, id(10)))!.fields.get(3)!.opId).toBe(before);
    expect((await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { status: 'void' } })).ok).toBe(true);
    expect([await balance(1), await balance(2)]).toEqual([100_000n, 0n]);
    expect(await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { status: 'pending' } })).toMatchObject({ ok: false, error: { code: 'invalid_status_change' } });
  });

  it('writes nothing for an edit that changes nothing, and reports unknown or deleted transfers', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect((await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: {} })).ok).toBe(true);
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
    expect(await h.run(transfers().updateTransfer, { fold: h.fold, id: id(99), changes: { note: 'x' } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await h.run(transfers().deleteTransfer, { fold: h.fold, id: id(10) });
    expect(await h.run(transfers().updateTransfer, { fold: h.fold, id: id(10), changes: { note: 'x' } })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('deleteTransfer and restoreTransfer', () => {
  beforeEach(async () => {
    await move(10);
  });

  it('takes both sides away together, and brings both back', async () => {
    await h.run(transfers().deleteTransfer, { fold: h.fold, id: id(10) });
    expect([await balance(1), await balance(2)]).toEqual([100_000n, 0n]);
    expect((await h.run(transfers().restoreTransfer, { fold: h.fold, id: id(10) })).ok).toBe(true);
    expect([await balance(1), await balance(2)]).toEqual([90_000n, 10_000n]);
  });

  it('restores within 30 days only, and only what was deleted', async () => {
    const t0 = 1_800_000_000_000;
    h.setNow(t0);
    await h.run(transfers().deleteTransfer, { fold: h.fold, id: id(10) });
    h.setNow(t0 + RETENTION_MS + 1);
    expect(await h.run(transfers().restoreTransfer, { fold: h.fold, id: id(10) })).toMatchObject({ ok: false, error: { code: 'retention_expired' } });
    expect(await h.run(transfers().restoreTransfer, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await move(11);
    expect(await h.run(transfers().restoreTransfer, { fold: h.fold, id: id(11) })).toMatchObject({ ok: false, error: { code: 'not_deleted' } });
    expect(await h.run(transfers().deleteTransfer, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('will not restore into an account that is gone', async () => {
    await h.run(transfers().deleteTransfer, { fold: h.fold, id: id(10) });
    await h.run(accounts.deleteLedgerAccount, { fold: h.fold, id: id(2), confirm: true });
    expect(await h.run(transfers().restoreTransfer, { fold: h.fold, id: id(10) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('lists deleted transfers with their days left', async () => {
    await h.run(transfers().deleteTransfer, { fold: h.fold, id: id(10) });
    const { recentlyDeletedTransfers } = await import('./queries/recently-deleted');
    expect(recentlyDeletedTransfers(await h.ledger(), h.clock.now).map((d) => [d.transfer.id, d.daysLeft])).toEqual([[id(10), 30]]);
  });
});
