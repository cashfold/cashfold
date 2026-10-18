import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_MINOR, MIN_MINOR } from '../../shared-kernel/money';
import { addDays } from '../../shared-kernel/local-date';
import { LedgerFixture, date, id } from '../../testing/index';
import type { TxnStatus } from '../domain/transaction';
import { TABLE } from '../domain/tables';
import { accountBalance, adjustmentFor } from './balance';
import { buildLedger } from './projections/ledger';

const START = date(2026, 1, 1);
const OPENING = date(2020, 1, 1);

interface Entry {
  readonly kind: 'expense' | 'income' | 'adjustment';
  readonly magnitude: bigint;
  readonly negative: boolean;
  readonly day: number;
  readonly status: TxnStatus;
}

const magnitude = fc.oneof(
  { weight: 3, arbitrary: fc.bigInt({ min: 1n, max: 1_000_000_000n }) },
  { weight: 2, arbitrary: fc.bigInt({ min: 2n ** 53n, max: 2n ** 60n }) },
);
const entry: fc.Arbitrary<Entry> = fc.record({
  kind: fc.constantFrom('expense', 'income', 'adjustment'),
  magnitude,
  negative: fc.boolean(),
  day: fc.integer({ min: 0, max: 60 }),
  status: fc.constantFrom('pending', 'posted', 'posted', 'posted', 'void'),
});
const opening = fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n });

const signed = (e: Entry): bigint => (e.kind === 'expense' ? -e.magnitude : e.kind === 'income' ? e.magnitude : e.negative ? -e.magnitude : e.magnitude);

function build(openingMinor: bigint, entries: readonly Entry[]) {
  const f = new LedgerFixture();
  const account = f.account({ openingBalanceMinor: openingMinor, openingDate: OPENING }, id(1));
  const txns = entries.map((e) => f.transaction(account, { amountMinor: signed(e), direction: e.kind, status: e.status, localDate: addDays(START, e.day) }));
  return { f, account, txns };
}

/** The definition from data-model.md, computed with no shared code. */
function reference(openingMinor: bigint, entries: readonly Entry[], asOf: number): bigint {
  let sum = openingMinor;
  for (const e of entries) {
    if (e.status === 'posted' && addDays(START, e.day) <= asOf) sum += signed(e);
  }
  return sum;
}

/** Deterministic Fisher-Yates driven by a Park-Miller generator, so a failing seed replays. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = (seed % 2_147_483_646) + 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 16_807) % 2_147_483_647;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const inRange = (v: bigint): boolean => v >= MIN_MINOR && v <= MAX_MINOR;

describe('balance = opening + sum of posted entries up to the date', () => {
  it('matches the definition for any sequence, including values above 2^53 (10,000 runs)', () => {
    fc.assert(
      fc.property(opening, fc.array(entry, { maxLength: 25 }), fc.integer({ min: -2, max: 62 }), (open, entries, asOfDay) => {
        const { f, account } = build(open, entries);
        const asOf = addDays(START, asOfDay);
        const got = accountBalance(buildLedger(f.fold), account, asOf);
        const want = reference(open, entries, asOf);
        if (inRange(want)) expect(got).toEqual({ ok: true, value: want });
        else expect(got).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
      }),
      { numRuns: 10_000 },
    );
  });

  it('is independent of the order operations arrive in', () => {
    fc.assert(
      fc.property(opening, fc.array(entry, { minLength: 1, maxLength: 15 }), fc.integer({ min: 0, max: 1_000_000 }), (open, entries, seed) => {
        const { f, account } = build(open, entries);
        const shuffled = shuffle(f.ops, seed);
        const other = new LedgerFixture();
        for (const op of shuffled) other.apply(op.rec, op.table, op.fields, op.sets, op.hlc.wallMs);
        const a = accountBalance(buildLedger(f.fold), account);
        const b = accountBalance(buildLedger(other.fold), account);
        expect(b).toEqual(a);
      }),
      { numRuns: 300 },
    );
  });

  it('excludes pending and void entries', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 1_000n });
    f.transaction(a, { amountMinor: -100n, status: 'posted' });
    f.transaction(a, { amountMinor: -200n, status: 'pending' });
    f.transaction(a, { amountMinor: -400n, status: 'void' });
    expect(accountBalance(buildLedger(f.fold), a)).toEqual({ ok: true, value: 900n });
  });

  it('excludes deleted entries and brings them back when restored', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 0n });
    const t = f.transaction(a, { amountMinor: 500n });
    expect(accountBalance(buildLedger(f.fold), a)).toEqual({ ok: true, value: 500n });
    f.remove(t, TABLE.transaction);
    expect(accountBalance(buildLedger(f.fold), a)).toEqual({ ok: true, value: 0n });
    f.restore(t, TABLE.transaction);
    expect(accountBalance(buildLedger(f.fold), a)).toEqual({ ok: true, value: 500n });
  });

  it('reports an unknown account', () => {
    expect(accountBalance(buildLedger(new LedgerFixture().fold), id(404))).toMatchObject({ ok: false, error: { code: 'unknown_account' } });
  });

  it('refuses a balance that does not fit in 64 bits instead of wrapping', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: MAX_MINOR });
    f.transaction(a, { amountMinor: 1n });
    expect(accountBalance(buildLedger(f.fold), a)).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });
});

describe('adjusting a balance to a target', () => {
  it('after booking the adjustment the balance on that date equals the target (2,000 runs)', () => {
    fc.assert(
      fc.property(opening, fc.array(entry, { maxLength: 15 }), fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n }), fc.integer({ min: 0, max: 60 }), (open, entries, target, day) => {
        const { f, account } = build(open, entries);
        const on = addDays(START, day);
        const delta = adjustmentFor(buildLedger(f.fold), account, on, target);
        if (!delta.ok) return; // only reachable on overflow, covered above
        if (delta.value === 0n) {
          expect(accountBalance(buildLedger(f.fold), account, on)).toEqual({ ok: true, value: target });
          return;
        }
        f.transaction(account, { amountMinor: delta.value, direction: 'adjustment', localDate: on });
        expect(accountBalance(buildLedger(f.fold), account, on)).toEqual({ ok: true, value: target });
      }),
      { numRuns: 2_000 },
    );
  });
});

describe('the projection equals a recomputation from the records', () => {
  it('gives the same balances whether built once or rebuilt after every change', () => {
    fc.assert(
      fc.property(opening, fc.array(entry, { maxLength: 12 }), (open, entries) => {
        const f = new LedgerFixture();
        const account = f.account({ openingBalanceMinor: open, openingDate: OPENING }, id(1));
        let incremental = accountBalance(buildLedger(f.fold), account);
        for (const e of entries) {
          f.transaction(account, { amountMinor: signed(e), direction: e.kind, status: e.status, localDate: addDays(START, e.day) });
          incremental = accountBalance(buildLedger(f.fold), account);
        }
        expect(incremental).toEqual(accountBalance(buildLedger(f.fold), account));
        const want = reference(open, entries, 99_999_999);
        if (inRange(want)) expect(incremental).toEqual({ ok: true, value: want });
      }),
      { numRuns: 500 },
    );
  });
});
