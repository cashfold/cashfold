import { describe, expect, it } from 'vitest';
import { createRepair } from '../../sync/application/repair';
import type { FieldValue } from '../../sync/domain/merge';
import { foldSettingsPatch, settingsRecordId } from '../../sharing/domain/fold';
import { LedgerFixture, date, id } from '../../testing/index';
import { ACCOUNT_FIELD, GROUP_FIELD, LABEL_FIELD, TABLE, TXN_FIELD } from '../domain/tables';
import { accountBalance, adjustmentFor } from './balance';
import { buildLedger } from './projections/ledger';
import { ledgerRepairRules } from './repair-rules';

describe('buildLedger', () => {
  it('projects every kind of record and ignores deleted ones', () => {
    const f = new LedgerFixture('EUR');
    const a = f.account({ name: 'Main' });
    const gone = f.account({ name: 'Gone' });
    f.remove(gone, TABLE.account);
    const group = id(70);
    f.apply(group, TABLE.accountGroup, new Map([[GROUP_FIELD.name, 'Banks']]));
    f.apply(id(71), TABLE.accountGroup, new Map([[GROUP_FIELD.name, 'Old']]));
    f.remove(id(71), TABLE.accountGroup);
    f.apply(id(80), TABLE.payee, new Map([[LABEL_FIELD.name, 'Cafe']]));
    f.apply(id(81), TABLE.payee, new Map([[LABEL_FIELD.name, 'Old cafe']]));
    f.remove(id(81), TABLE.payee);
    f.apply(id(90), TABLE.tag, new Map([[LABEL_FIELD.name, 'fun']]));
    f.apply(id(91), TABLE.tag, new Map([[LABEL_FIELD.name, 'old']]));
    f.remove(id(91), TABLE.tag);
    f.exchangeRate({ quote: 'USD' === 'USD' ? ('GBP' as never) : ('GBP' as never), asOfUtcS: 5, rateE12: 1n as never, source: 'service' }, id(95));
    const dead = f.exchangeRate({ quote: 'JPY' as never, asOfUtcS: 5, rateE12: 1n as never, source: 'service' }, id(96));
    f.remove(dead, TABLE.exchangeRate);
    f.category({ name: 'Food' }, id(60));
    f.remove(f.category({ name: 'Old' }, id(61)), TABLE.category);
    f.apply(id(500), TABLE.budget, new Map([[1, 'ignored by the ledger']]));

    const ledger = buildLedger(f.fold);
    expect(ledger.baseCurrency).toBe('EUR');
    expect([...ledger.accounts.keys()]).toEqual([a]);
    expect([...ledger.groups.keys()]).toEqual([group]);
    expect([...ledger.payees.keys()]).toEqual([id(80)]);
    expect([...ledger.tags.keys()]).toEqual([id(90)]);
    expect([...ledger.categories.keys()]).toEqual([id(60)]);
    expect(ledger.rates.map((r) => r.quote)).toEqual(['GBP']);
  });

  it('skips malformed records of every kind instead of failing', () => {
    const f = new LedgerFixture();
    for (const table of [TABLE.account, TABLE.accountGroup, TABLE.category, TABLE.payee, TABLE.tag, TABLE.transaction, TABLE.exchangeRate]) {
      f.apply(f.nextId(), table, new Map([[99, 'garbage']]));
    }
    const ledger = buildLedger(f.fold);
    expect([ledger.accounts.size, ledger.groups.size, ledger.categories.size, ledger.payees.size, ledger.tags.size, ledger.transactions.size, ledger.deleted.size, ledger.rates.length]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('reads a base currency only if it is a real one', () => {
    for (const bad of ['ZZZ', 5n]) {
      const f = new LedgerFixture();
      const s = foldSettingsPatch({ baseCurrency: 'USD' });
      f.apply(settingsRecordId(id(0xf0)), s.table, new Map([[2, bad]]));
      expect(buildLedger(f.fold).baseCurrency).toBeUndefined(); // the newer, unusable value wins, so no base is assumed
    }
    const none = new LedgerFixture();
    none.fold = new Map();
    expect(buildLedger(none.fold).baseCurrency).toBeUndefined();
  });

  it('keeps the time of deletion for a deleted transaction', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const t = f.transaction(a, {});
    f.remove(t, TABLE.transaction, 777);
    expect(buildLedger(f.fold).deleted.get(t)?.deletedAtMs).toBe(777);
  });

  it('leaves out hidden records entirely', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const t = f.transaction(a, {});
    const ledger = buildLedger(f.fold, { hidden: new Set([t, a]), excluded: new Set() });
    expect(ledger.accounts.size + ledger.transactions.size).toBe(0);
  });

  it('orders entries by date and then id, and groups them by account', () => {
    const f = new LedgerFixture();
    const a = f.account();
    f.transaction(a, { localDate: date(2026, 1, 2) }, id(30));
    f.transaction(a, { localDate: date(2026, 1, 1) }, id(40));
    f.transaction(a, { localDate: date(2026, 1, 2) }, id(20));
    expect(buildLedger(f.fold).entriesByAccount.get(a)!.map((e) => e.refId)).toEqual([id(40), id(20), id(30)]);
  });

  it('ignores a repair report that excludes nothing', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 5n });
    expect(accountBalance(buildLedger(f.fold, createRepair(ledgerRepairRules).run(f.fold)), a)).toEqual({ ok: true, value: 5n });
  });

  it('survives a transaction record whose table says something else', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const t = f.transaction(a, {});
    f.apply(t, TABLE.tag, new Map([[LABEL_FIELD.name, 'conflict']]));
    expect(() => buildLedger(f.fold)).not.toThrow();
  });

  it('an account record without its optional fields still reads', () => {
    const f = new LedgerFixture();
    f.apply(id(1), TABLE.account, new Map<number, FieldValue>([[ACCOUNT_FIELD.kind, 1n], [ACCOUNT_FIELD.name, 'Bare'], [ACCOUNT_FIELD.currency, 'USD'], [ACCOUNT_FIELD.openingBalanceMinor, 0n], [ACCOUNT_FIELD.openingDate, 20_260_101n]]));
    expect(buildLedger(f.fold).accounts.get(id(1))).toMatchObject({ name: 'Bare', includeInNetWorth: true });
  });
});

describe('adjustmentFor', () => {
  it('reports an unknown account and refuses targets or differences outside 64 bits', () => {
    const f = new LedgerFixture();
    const a = f.account({ openingBalanceMinor: 2n ** 62n });
    const ledger = buildLedger(f.fold);
    expect(adjustmentFor(ledger, id(404), date(2026, 1, 1), 0n)).toMatchObject({ ok: false, error: { code: 'unknown_account' } });
    expect(adjustmentFor(ledger, a, date(2026, 1, 1), -(2n ** 63n))).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
    expect(adjustmentFor(ledger, a, date(2026, 1, 1), 2n ** 63n)).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });
});

describe('a transaction record with an unreadable tombstone', () => {
  it('stays visible until the tombstone says otherwise', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const t = f.transaction(a, { amountMinor: -5n });
    f.apply(t, TABLE.transaction, new Map([[0xffff, 'maybe']]));
    expect(buildLedger(f.fold).transactions.has(t)).toBe(true);
    expect(buildLedger(f.fold).transactions.get(t)!.amountMinor).toBe(-5n);
    expect(TXN_FIELD.note).toBeGreaterThan(0);
  });
});
