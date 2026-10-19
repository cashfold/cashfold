import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import { validateNewAccount, type Account } from './account';
import { TRANSFER_FIELD } from './tables';
import { date } from '../../testing/index';
import { ledgerGroupsHave } from './ledger-groups';
import { LEDGER_GROUPS } from './ledger-groups';
import { TABLE } from './tables';
import { transferFieldPatch, validateTransfer, type TransferInput } from './transfer';

const account = (n: number, currency = 'USD', over: Partial<Account> = {}): Account => {
  const r = validateNewAccount({ kind: 'checking', name: `A${n}`, currency, openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
  if (!r.ok) throw new Error('fixture');
  return { ...r.value, id: id(n), groupIds: [], ...over };
};
const NOON = Date.UTC(2026, 2, 15, 12);
const input = (over: Partial<TransferInput> = {}): TransferInput => ({
  fromAmountMinor: 10_000n, toAmountMinor: 10_000n, occurredUtcMs: NOON, tzOffsetMin: 0, ...over,
});

describe('Transfer: validation', () => {
  it('moves money between two different accounts', () => {
    const r = validateTransfer(input(), account(1), account(2));
    expect(r).toMatchObject({ ok: true, value: { fromAmountMinor: 10_000n, toAmountMinor: 10_000n, localDate: 20_260_315, status: 'posted', note: '' } });
  });

  it('refuses the same account on both sides', () => {
    expect(validateTransfer(input(), account(1), account(1))).toMatchObject({ ok: false, error: { code: 'same_account' } });
  });

  it('needs both amounts above zero', () => {
    for (const bad of [{ fromAmountMinor: 0n }, { toAmountMinor: 0n }, { fromAmountMinor: -5n }, { toAmountMinor: -5n }]) {
      expect(validateTransfer(input(bad), account(1), account(2)), JSON.stringify(bad, (_, v) => (typeof v === 'bigint' ? `${v}n` : v))).toMatchObject({ ok: false, error: { code: 'invalid_transfer_amount' } });
    }
  });

  it('requires equal amounts when both accounts share a currency', () => {
    expect(validateTransfer(input({ toAmountMinor: 9_999n }), account(1), account(2))).toMatchObject({ ok: false, error: { code: 'amounts_must_match' } });
  });

  it('takes each side\'s own amount across currencies, never working one out from the other', () => {
    const r = validateTransfer(input({ fromAmountMinor: 10_000n, toAmountMinor: 9_137n }), account(1, 'USD'), account(2, 'EUR'));
    expect(r).toMatchObject({ ok: true, value: { fromAmountMinor: 10_000n, toAmountMinor: 9_137n } });
  });

  it('keeps amounts above 2^53 exact and refuses ones beyond 64 bits', () => {
    const big = 2n ** 62n + 7n;
    expect(validateTransfer(input({ fromAmountMinor: big, toAmountMinor: big }), account(1), account(2))).toMatchObject({ ok: true, value: { fromAmountMinor: big } });
    expect(validateTransfer(input({ fromAmountMinor: 2n ** 63n, toAmountMinor: 2n ** 63n }), account(1), account(2))).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });

  it('derives the local date, limits the note and checks the status', () => {
    expect(validateTransfer(input({ occurredUtcMs: Date.UTC(2026, 2, 15, 23, 30), tzOffsetMin: 120 }), account(1), account(2))).toMatchObject({ ok: true, value: { localDate: 20_260_316 } });
    expect(validateTransfer(input({ occurredUtcMs: -1 }), account(1), account(2))).toMatchObject({ ok: false, error: { code: 'invalid_time' } });
    expect(validateTransfer(input({ note: 'n'.repeat(2001) }), account(1), account(2))).toMatchObject({ ok: false, error: { code: 'note_too_long' } });
    expect(validateTransfer(input({ status: 'lost' as never }), account(1), account(2))).toMatchObject({ ok: false, error: { code: 'invalid_status' } });
  });

  it('is refused by an archived account on either side, and a goal account accepts it', () => {
    expect(validateTransfer(input(), account(1, 'USD', { archived: true }), account(2))).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    expect(validateTransfer(input(), account(1), account(2, 'USD', { archived: true }))).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    expect(validateTransfer(input(), account(1), account(2, 'USD', { kind: 'goal' })).ok).toBe(true);
  });

  it('refuses a date before either account opened', () => {
    const late = account(2, 'USD', { openingDate: date(2026, 6, 1) });
    expect(validateTransfer(input(), account(1), late)).toMatchObject({ ok: false, error: { code: 'before_opening_date' } });
  });
});

describe('Transfer: one inseparable record', () => {
  it('writes the whole amount group together', () => {
    const r = validateTransfer(input({ fromAmountMinor: 10_000n, toAmountMinor: 9_137n }), account(1, 'USD'), account(2, 'EUR'));
    if (!r.ok) throw new Error('fixture');
    const patch = transferFieldPatch({ fromAccountId: id(1), toAccountId: id(2), ...r.value, fxRateId: null });
    for (const f of [TRANSFER_FIELD.fromAccountId, TRANSFER_FIELD.toAccountId, TRANSFER_FIELD.fromAmountMinor, TRANSFER_FIELD.toAmountMinor, TRANSFER_FIELD.fxRateId]) expect(patch.has(f)).toBe(true);
    expect(patch.get(TRANSFER_FIELD.toAmountMinor)).toBe(9_137n);
  });

  it('registers that group so a half-written transfer is refused', () => {
    expect(ledgerGroupsHave(TABLE.transfer, [TRANSFER_FIELD.fromAccountId, TRANSFER_FIELD.toAccountId, TRANSFER_FIELD.fromAmountMinor, TRANSFER_FIELD.toAmountMinor, TRANSFER_FIELD.fxRateId])).toBe(true);
    expect(LEDGER_GROUPS.get(TABLE.transfer)).toHaveLength(1);
  });

  it('writes only what changed outside the group', () => {
    expect([...transferFieldPatch({ note: 'x' }).keys()]).toEqual([TRANSFER_FIELD.note]);
    expect(transferFieldPatch({ status: 'void' }).get(TRANSFER_FIELD.status)).toBe(2n);
  });
});
