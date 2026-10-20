import { describe, expect, it } from 'vitest';
import { createRepair, buildNeedsAttention } from '../../sync/application/repair';
import { LedgerFixture, id } from '../../testing/index';
import { TABLE, CATEGORY_FIELD, TXN_FIELD } from '../domain/tables';
import { ledgerRepairRules } from './repair-rules';
import { buildLedger } from './projections/ledger';
import { accountBalance } from './balance';

const repair = createRepair(ledgerRepairRules);
const run = (f: LedgerFixture) => repair.run(f.fold);
const kinds = (f: LedgerFixture) => run(f).findings.map((x) => `${x.kind}:${x.ref ?? ''}`);

describe('ledger repair rules', () => {
  it('finds nothing wrong in a healthy ledger', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const c = f.category({ name: 'Food' });
    f.category({ name: 'Groceries', parentId: c });
    f.transaction(a, { amountMinor: -100n, categoryId: c });
    expect(run(f).findings).toEqual([]);
  });

  describe('orphan transaction', () => {
    it('flags and hides a transaction whose account does not exist', () => {
      const f = new LedgerFixture();
      const t = f.transaction(id(404), { amountMinor: -100n });
      const report = run(f);
      expect(report.findings).toEqual([{ kind: 'orphan_transaction', ref: t, messageKey: 'attention.orphan_transaction', effect: 'hide' }]);
      expect(report.hidden.has(t)).toBe(true);
    });

    it('flags a transaction whose account was deleted on another device', () => {
      const f = new LedgerFixture();
      const a = f.account();
      const t = f.transaction(a, { amountMinor: -100n });
      f.remove(a, TABLE.account);
      expect(kinds(f)).toEqual([`orphan_transaction:${t}`]);
    });

    it('does not flag a deleted transaction, and recovers once the account is back', () => {
      const f = new LedgerFixture();
      const a = f.account();
      const t = f.transaction(a, { amountMinor: -100n });
      f.remove(t, TABLE.transaction);
      f.remove(a, TABLE.account);
      expect(kinds(f)).toEqual([]);
      f.restore(t, TABLE.transaction);
      expect(kinds(f)).toEqual([`orphan_transaction:${t}`]);
      f.restore(a, TABLE.account);
      expect(kinds(f)).toEqual([]);
    });

    it('keeps the orphan out of lists and out of every balance', () => {
      const f = new LedgerFixture();
      const a = f.account({ openingBalanceMinor: 1_000n });
      const orphan = f.transaction(id(404), { amountMinor: -100n });
      const ledger = buildLedger(f.fold, run(f));
      expect(ledger.transactions.has(orphan)).toBe(false);
      expect(accountBalance(ledger, a)).toEqual({ ok: true, value: 1_000n });
    });
  });

  describe('category tree', () => {
    it('flags a category deeper than two levels and reads it as a top-level category', () => {
      const f = new LedgerFixture();
      const root = f.category({ name: 'Root' });
      const child = f.category({ name: 'Child', parentId: root });
      const grand = f.category({ name: 'Grand', parentId: child });
      expect(kinds(f)).toEqual([`category_depth:${grand}`]);
      const ledger = buildLedger(f.fold, run(f));
      expect(ledger.categories.get(grand)!.parentId).toBeNull();
      expect(ledger.categories.get(child)!.parentId).toBe(root);
    });

    it('flags a cycle made by two devices moving categories under each other, and breaks it the same way everywhere', () => {
      const f = new LedgerFixture();
      const a = f.category({ name: 'A' });
      const b = f.category({ name: 'B' });
      f.edit(a, TABLE.category, new Map([[CATEGORY_FIELD.parentId, b]]));
      f.edit(b, TABLE.category, new Map([[CATEGORY_FIELD.parentId, a]]));
      expect(kinds(f).sort()).toEqual([`category_cycle:${a}`, `category_cycle:${b}`].sort());
      const ledger = buildLedger(f.fold, run(f));
      expect(ledger.categories.get(a)!.parentId).toBeNull();
      expect(ledger.categories.get(b)!.parentId).toBeNull();
    });

    it('flags a category whose parent was deleted', () => {
      const f = new LedgerFixture();
      const root = f.category({ name: 'Root' });
      const child = f.category({ name: 'Child', parentId: root });
      f.remove(root, TABLE.category);
      expect(kinds(f)).toEqual([`category_orphan:${child}`]);
      expect(buildLedger(f.fold, run(f)).categories.get(child)!.parentId).toBeNull();
    });

    it('flags a child whose direction differs from its parent', () => {
      const f = new LedgerFixture();
      const root = f.category({ name: 'Root', direction: 'expense' });
      const child = f.category({ name: 'Child', direction: 'income', parentId: root });
      expect(kinds(f)).toEqual([`category_direction_mismatch:${child}`]);
    });
  });

  describe('transaction invariants', () => {
    it('flags a currency that differs from the account and excludes it from the balance', () => {
      const f = new LedgerFixture();
      const a = f.account({ openingBalanceMinor: 1_000n });
      const t = f.transaction(a, { amountMinor: -100n, currency: 'EUR' as never });
      const report = run(f);
      expect(report.findings).toEqual([{ kind: 'currency_mismatch', ref: t, messageKey: 'attention.currency_mismatch', effect: 'exclude_from_balance' }]);
      expect(accountBalance(buildLedger(f.fold, report), a)).toEqual({ ok: true, value: 1_000n });
      // It is still listed so the user can find and fix it.
      expect(buildLedger(f.fold, report).transactions.has(t)).toBe(true);
    });

    it('flags an expense with a positive amount (two devices edited the sign and the type)', () => {
      const f = new LedgerFixture();
      const a = f.account({ openingBalanceMinor: 1_000n });
      const t = f.transaction(a, { amountMinor: -100n, direction: 'expense' });
      f.edit(t, TABLE.transaction, new Map([[TXN_FIELD.amountMinor, 100n]]));
      expect(kinds(f)).toEqual([`sign_mismatch:${t}`]);
      expect(accountBalance(buildLedger(f.fold, run(f)), a)).toEqual({ ok: true, value: 1_000n });
    });

    it('flags income that is not positive and an adjustment of zero', () => {
      const f = new LedgerFixture();
      const a = f.account();
      const income = f.transaction(a, { amountMinor: 100n, direction: 'income' });
      f.edit(income, TABLE.transaction, new Map([[TXN_FIELD.amountMinor, -100n]]));
      const zero = f.transaction(a, { amountMinor: 5n, direction: 'adjustment' });
      f.edit(zero, TABLE.transaction, new Map([[TXN_FIELD.amountMinor, 0n]]));
      expect(kinds(f).sort()).toEqual([`sign_mismatch:${income}`, `sign_mismatch:${zero}`].sort());
    });
  });

  it('flags two exchange rates for the same currency and time', () => {
    const f = new LedgerFixture();
    const one = f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: 1n as never, source: 'service' }, id(1));
    const two = f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 100, rateE12: 2n as never, source: 'service' }, id(2));
    expect(kinds(f)).toEqual([`duplicate_rate:${[one, two].sort().reverse()[0]}`]);
  });

  it('gives the same findings whatever order the operations arrived in', () => {
    const build = (order: number[]) => {
      const source = new LedgerFixture();
      const a = source.account();
      source.transaction(a, { amountMinor: -100n, currency: 'EUR' as never });
      source.transaction(id(404), { amountMinor: -5n });
      const other = new LedgerFixture();
      for (const i of order) {
        const op = source.ops[i]!;
        other.apply(op.rec, op.table, op.fields, op.sets, op.hlc.wallMs);
      }
      return other;
    };
    const forward = run(build([0, 1, 2])).findings.map((x) => `${x.kind}`);
    const backward = run(build([2, 1, 0])).findings.map((x) => `${x.kind}`);
    expect(backward).toEqual(forward);
  });

  it('feeds Needs attention with messages that carry no amounts, names or notes', () => {
    const f = new LedgerFixture();
    f.transaction(id(404), { amountMinor: -123_456n, note: 'secret note' });
    const items = buildNeedsAttention(run(f), []);
    expect(JSON.stringify(items)).not.toMatch(/123456|secret/);
    expect(items[0]).toMatchObject({ kind: 'orphan_transaction', messageKey: 'attention.orphan_transaction' });
  });

  it('a malformed record is reported and ignored instead of breaking the ledger', () => {
    const f = new LedgerFixture();
    f.apply(id(77), TABLE.transaction, new Map([[TXN_FIELD.note, 'no account, no amount']]));
    expect(() => buildLedger(f.fold, run(f))).not.toThrow();
    expect(kinds(f)).toEqual([`malformed_record:${id(77)}`]);
  });
});
