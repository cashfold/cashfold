import { describe, expect, it } from 'vitest';
import { localDate } from '../../shared-kernel/local-date';
import { id } from '../../testing/index';
import { TXN_FIELD } from './tables';
import {
  MAX_NOTE, MAX_TAGS, canTransition, transactionFieldPatch, validateTransactionEntry, type TransactionEntryInput,
} from './transaction';
import type { Account } from './account';
import { validateNewAccount } from './account';

const account = (currency = 'USD'): Account => {
  const d = localDate(2020, 1, 1);
  if (!d.ok) throw new Error('fixture');
  const r = validateNewAccount({ kind: 'checking', name: 'Main', currency, openingBalanceMinor: 0n, openingDate: d.value });
  if (!r.ok) throw new Error('fixture');
  return { ...r.value, id: id(1), groupIds: [] };
};

// 2026-03-15T12:00:00Z
const NOON = Date.UTC(2026, 2, 15, 12, 0, 0);
const entry = (over: Partial<TransactionEntryInput> = {}): TransactionEntryInput => ({
  direction: 'expense', amountMinor: -450n, currency: 'USD', occurredUtcMs: NOON, tzOffsetMin: 0, ...over,
});

describe('Transaction: sign and currency rules', () => {
  it('requires an expense to be negative', () => {
    expect(validateTransactionEntry(entry({ direction: 'expense', amountMinor: -1n }), account()).ok).toBe(true);
    expect(validateTransactionEntry(entry({ direction: 'expense', amountMinor: 1n }), account())).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
    expect(validateTransactionEntry(entry({ direction: 'expense', amountMinor: 0n }), account())).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
  });

  it('requires income to be positive', () => {
    expect(validateTransactionEntry(entry({ direction: 'income', amountMinor: 1n }), account()).ok).toBe(true);
    expect(validateTransactionEntry(entry({ direction: 'income', amountMinor: -1n }), account())).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
  });

  it('lets an adjustment be any non-zero amount', () => {
    expect(validateTransactionEntry(entry({ direction: 'adjustment', amountMinor: 5n }), account()).ok).toBe(true);
    expect(validateTransactionEntry(entry({ direction: 'adjustment', amountMinor: -5n }), account()).ok).toBe(true);
    expect(validateTransactionEntry(entry({ direction: 'adjustment', amountMinor: 0n }), account())).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
  });

  it('keeps amounts above 2^53 exact and rejects ones outside 64 bits', () => {
    const big = 2n ** 62n + 1n;
    const r = validateTransactionEntry(entry({ direction: 'income', amountMinor: big }), account());
    expect(r.ok && r.value.amountMinor).toBe(big);
    expect(validateTransactionEntry(entry({ direction: 'income', amountMinor: 2n ** 63n }), account())).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });

  it('requires the currency to equal the account currency', () => {
    expect(validateTransactionEntry(entry({ currency: 'EUR' }), account('USD'))).toMatchObject({ ok: false, error: { code: 'currency_mismatch' } });
    expect(validateTransactionEntry(entry({ currency: 'EUR' }), account('EUR')).ok).toBe(true);
  });
});

describe('Transaction: date', () => {
  it('derives the local date from the instant and its own offset', () => {
    const r = validateTransactionEntry(entry({ occurredUtcMs: Date.UTC(2026, 2, 15, 23, 30), tzOffsetMin: 120 }), account());
    expect(r.ok && r.value.localDate).toBe(20_260_316); // 01:30 the next day at UTC+2
    const west = validateTransactionEntry(entry({ occurredUtcMs: Date.UTC(2026, 2, 15, 1, 0), tzOffsetMin: -300 }), account());
    expect(west.ok && west.value.localDate).toBe(20_260_314);
  });

  it('rejects an offset outside real time zones', () => {
    expect(validateTransactionEntry(entry({ tzOffsetMin: 15 * 60 }), account())).toMatchObject({ ok: false, error: { code: 'invalid_time' } });
    expect(validateTransactionEntry(entry({ tzOffsetMin: -13 * 60 }), account())).toMatchObject({ ok: false, error: { code: 'invalid_time' } });
    expect(validateTransactionEntry(entry({ tzOffsetMin: 1.5 }), account())).toMatchObject({ ok: false, error: { code: 'invalid_time' } });
  });

  it('rejects a non-integer or negative instant', () => {
    expect(validateTransactionEntry(entry({ occurredUtcMs: -1 }), account())).toMatchObject({ ok: false, error: { code: 'invalid_time' } });
    expect(validateTransactionEntry(entry({ occurredUtcMs: Number.NaN }), account())).toMatchObject({ ok: false, error: { code: 'invalid_time' } });
  });
});

describe('Transaction: tags, note, place', () => {
  it('allows at most 8 tags and no duplicates', () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => id(100 + i));
    expect(validateTransactionEntry(entry({ tagIds: tags(MAX_TAGS) }), account()).ok).toBe(true);
    expect(validateTransactionEntry(entry({ tagIds: tags(MAX_TAGS + 1) }), account())).toMatchObject({ ok: false, error: { code: 'too_many_tags' } });
    const dup = validateTransactionEntry(entry({ tagIds: [id(100), id(100)] }), account());
    expect(dup.ok && dup.value.tagIds).toEqual([id(100)]);
  });

  it('limits the note to 2,000 characters', () => {
    expect(validateTransactionEntry(entry({ note: 'n'.repeat(MAX_NOTE) }), account()).ok).toBe(true);
    expect(validateTransactionEntry(entry({ note: 'n'.repeat(MAX_NOTE + 1) }), account())).toMatchObject({ ok: false, error: { code: 'note_too_long' } });
  });

  it('keeps a place as integers in 1e-7 degrees and checks the ranges', () => {
    const ok = validateTransactionEntry(entry({ place: { name: 'Cafe', latE7: 515_074_000, lonE7: -1_278_000 } }), account());
    expect(ok.ok && ok.value.place).toEqual({ name: 'Cafe', latE7: 515_074_000, lonE7: -1_278_000 });
    expect(validateTransactionEntry(entry({ place: { name: 'x', latE7: 900_000_001, lonE7: 0 } }), account())).toMatchObject({ ok: false, error: { code: 'invalid_place' } });
    expect(validateTransactionEntry(entry({ place: { name: 'x', latE7: 0, lonE7: -1_800_000_001 } }), account())).toMatchObject({ ok: false, error: { code: 'invalid_place' } });
    expect(validateTransactionEntry(entry({ place: { name: 'x', latE7: 1.5, lonE7: 0 } }), account())).toMatchObject({ ok: false, error: { code: 'invalid_place' } });
  });
});

describe('Transaction: status', () => {
  it('defaults to posted', () => {
    const r = validateTransactionEntry(entry(), account());
    expect(r.ok && r.value.status).toBe('posted');
  });

  it('allows Pending to Posted or Void, Posted to Void, and Void to Posted only', () => {
    expect(canTransition('pending', 'posted')).toBe(true);
    expect(canTransition('pending', 'void')).toBe(true);
    expect(canTransition('posted', 'void')).toBe(true);
    expect(canTransition('void', 'posted')).toBe(true);
    expect(canTransition('posted', 'pending')).toBe(false);
    expect(canTransition('void', 'pending')).toBe(false);
    expect(canTransition('posted', 'posted')).toBe(true);
  });
});

describe('Transaction: record fields', () => {
  it('writes the amount group together or not at all', () => {
    const r = validateTransactionEntry(entry(), account());
    if (!r.ok) throw new Error('fixture');
    const full = transactionFieldPatch({ accountId: id(1), ...r.value, baseAmountMinor: -450n, baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null });
    for (const f of [TXN_FIELD.amountMinor, TXN_FIELD.currency, TXN_FIELD.baseAmountMinor, TXN_FIELD.baseCurrency, TXN_FIELD.fxRateId, TXN_FIELD.fxBaseRateId, TXN_FIELD.direction]) {
      expect(full.has(f)).toBe(true);
    }
    const noteOnly = transactionFieldPatch({ note: 'only' });
    expect(noteOnly.has(TXN_FIELD.amountMinor)).toBe(false);
    expect(noteOnly.has(TXN_FIELD.currency)).toBe(false);
  });

  it('encodes direction as 0 adjustment, 1 expense, 2 income and status as 0, 1, 2', () => {
    const p = transactionFieldPatch({ direction: 'income', status: 'void' });
    expect(p.get(TXN_FIELD.direction)).toBe(2n);
    expect(p.get(TXN_FIELD.status)).toBe(2n);
  });
});

describe('Transaction: remaining rules', () => {
  it('rejects an unknown currency, an unknown direction and an unknown status', () => {
    expect(validateTransactionEntry(entry({ currency: 'ZZZ' }), account())).toMatchObject({ ok: false, error: { code: 'unknown_currency' } });
    expect(validateTransactionEntry(entry({ direction: 'transfer' as never }), account())).toMatchObject({ ok: false, error: { code: 'invalid_amount_sign' } });
    expect(validateTransactionEntry(entry({ status: 'lost' as never }), account())).toMatchObject({ ok: false, error: { code: 'invalid_status' } });
  });

  it('writes an origin and clears it', () => {
    const set = transactionFieldPatch({ origin: { scheduleId: id(5), n: 3 } });
    expect(set.get(TXN_FIELD.originScheduleId)).toBe(id(5));
    expect(set.get(TXN_FIELD.originN)).toBe(3n);
    const cleared = transactionFieldPatch({ origin: null });
    expect(cleared.get(TXN_FIELD.originScheduleId)).toBeNull();
    expect(cleared.get(TXN_FIELD.originN)).toBeNull();
  });

  it('writes a place and clears it', () => {
    expect(transactionFieldPatch({ place: null }).get(TXN_FIELD.latE7)).toBeNull();
    expect(transactionFieldPatch({ place: { name: 'x', latE7: 1, lonE7: 2 } }).get(TXN_FIELD.lonE7)).toBe(2n);
  });
});
