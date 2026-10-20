import { beforeEach, describe, expect, it } from 'vitest';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createAdjustBalance, noonOf } from './adjust-balance';
import { accountBalance } from './balance';
import { createTransactionCommands } from './transaction-commands';

const accounts = createAccountCommands();
let h: LedgerHarness;
const txns = () => createTransactionCommands({ clock: { nowMs: () => h.clock.now } });
const adjust = () => createAdjustBalance({ clock: { nowMs: () => h.clock.now } }).adjustBalance;
const balance = async (on?: ReturnType<typeof date>) => {
  const r = accountBalance(await h.ledger(), id(1), on);
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

beforeEach(async () => {
  h = await ledgerHarness();
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 10_000n, openingDate: date(2026, 1, 1) });
  await h.run(txns().addTransaction, { fold: h.fold, id: id(10), accountId: id(1), direction: 'expense', amountMinor: -2_500n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 2, 1, 12), tzOffsetMin: 0 });
});

describe('adjustBalance', () => {
  it('books the exact difference as an adjustment entry', async () => {
    const r = await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: 9_000n, date: date(2026, 3, 5) });
    expect(r).toEqual({ ok: true, value: { amountMinor: 1_500n } });
    expect(await balance(date(2026, 3, 5))).toBe(9_000n);
    expect((await h.ledger()).transactions.get(id(20))).toMatchObject({ direction: 'adjustment', amountMinor: 1_500n, status: 'posted', localDate: 20_260_305 });
  });

  it('adjusts downwards too, and the balance stays derived', async () => {
    await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: 100n, date: date(2026, 3, 5) });
    expect(await balance(date(2026, 3, 5))).toBe(100n);
    expect((await h.ledger()).transactions.get(id(20))!.amountMinor).toBe(-7_400n);
  });

  it('is dated: an earlier date is unaffected by it', async () => {
    await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: 9_000n, date: date(2026, 3, 5) });
    expect(await balance(date(2026, 3, 1))).toBe(7_500n);
  });

  it('does nothing when the balance already equals the target', async () => {
    expect(await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: 7_500n, date: date(2026, 3, 5) })).toMatchObject({ ok: false, error: { code: 'no_adjustment_needed' } });
    expect((await h.ledger()).transactions.has(id(20))).toBe(false);
  });

  it('works for a target below zero and for amounts above 2^53', async () => {
    const big = 2n ** 58n;
    await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: -big, date: date(2026, 3, 5) });
    expect(await balance(date(2026, 3, 5))).toBe(-big);
  });

  it('is refused on an archived account and for an unknown account', async () => {
    await h.run(accounts.archiveAccount, { fold: h.fold, id: id(1), archived: true });
    expect(await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: 1n, date: date(2026, 3, 5) })).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    expect(await h.run(adjust(), { fold: h.fold, id: id(21), accountId: id(99), target: 1n, date: date(2026, 3, 5) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('can be dated before the opening date only if the account allows it (it does not)', async () => {
    expect(await h.run(adjust(), { fold: h.fold, id: id(20), accountId: id(1), target: 1n, date: date(2025, 12, 31) })).toMatchObject({ ok: false, error: { code: 'before_opening_date' } });
  });

  it('lands on the requested local date in any time zone', () => {
    for (const tz of [-720, -300, 0, 330, 840]) {
      const ms = noonOf(date(2026, 3, 5), tz);
      expect(new Date(ms + tz * 60_000).toISOString().slice(0, 10)).toBe('2026-03-05');
    }
  });
});
