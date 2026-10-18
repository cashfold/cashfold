import { beforeEach, describe, expect, it } from 'vitest';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createRateCommands, serviceRateId } from './rate-commands';
import { createRevalue } from './revalue';
import { createTransactionCommands } from './transaction-commands';

const accounts = createAccountCommands();
const rates = createRateCommands();
let h: LedgerHarness;
const txns = () => createTransactionCommands({ clock: { nowMs: () => h.clock.now } });
const revalue = () => createRevalue({ clock: { nowMs: () => h.clock.now } }).revalue;

const JAN = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const FEB = Math.floor(Date.UTC(2026, 1, 1) / 1000);
const MAR = Math.floor(Date.UTC(2026, 2, 1) / 1000);
const E12 = 10n ** 12n;

beforeEach(async () => {
  h = await ledgerHarness({ baseCurrency: 'USD' });
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Euro', currency: 'EUR', openingBalanceMinor: 0n, openingDate: date(2025, 1, 1) });
});

const spendEur = (n: number, whenS: number, minor = -1_000n) => h.run(txns().addTransaction, {
  fold: h.fold, id: id(n), accountId: id(1), direction: 'expense' as const, amountMinor: minor, currency: 'EUR', occurredUtcMs: whenS * 1000, tzOffsetMin: 0,
});

describe('exchange rates', () => {
  it('stores a custom rate and uses it for a base-currency snapshot', async () => {
    const set = await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: (9n * E12) / 10n }); // 0.90 EUR per USD
    expect(set).toEqual({ ok: true, value: id(30) });
    const r = await spendEur(10, JAN + 3600, -900n); // -9.00 EUR = -10.00 USD
    expect(r).toMatchObject({ ok: true, value: { baseAmountMinor: -1_000n, baseCurrency: 'USD', fxRateId: id(30), fxBaseRateId: null } });
  });

  it('refuses a foreign-currency entry while no rate is known, and says which currency', async () => {
    expect(await spendEur(10, JAN)).toMatchObject({ ok: false, error: { code: 'rate_required', currency: 'EUR' } });
    expect((await h.ledger()).transactions.size).toBe(0);
  });

  it('uses the nearest prior rate: a backdated entry gets the historic rate', async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: E12 });
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(31), quote: 'EUR', asOfUtcS: MAR, rateE12: 2n * E12 });
    expect(await spendEur(10, JAN + 10, -1_000n)).toMatchObject({ ok: true, value: { baseAmountMinor: -1_000n } });
    expect(await spendEur(11, FEB, -1_000n)).toMatchObject({ ok: true, value: { baseAmountMinor: -1_000n } });
    expect(await spendEur(12, MAR + 5, -1_000n)).toMatchObject({ ok: true, value: { baseAmountMinor: -500n } });
  });

  it('freezes the base amount: a rate added later does not change history', async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: E12 });
    await spendEur(10, FEB, -1_000n);
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(31), quote: 'EUR', asOfUtcS: JAN + 1, rateE12: 4n * E12 });
    expect((await h.ledger()).transactions.get(id(10))!.baseAmountMinor).toBe(-1_000n);
  });

  it('setting the same quote and time again updates the user rate instead of adding another', async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: E12 });
    const again = await h.run(rates.setCustomRate, { fold: h.fold, id: id(31), quote: 'EUR', asOfUtcS: JAN, rateE12: 2n * E12 });
    expect(again).toEqual({ ok: true, value: id(30) });
    const ledger = await h.ledger();
    expect(ledger.rates).toHaveLength(1);
    expect(ledger.rates[0]).toMatchObject({ id: id(30), rateE12: 2n * E12 });
  });

  it('validates a custom rate', async () => {
    expect(await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: 0n })).toMatchObject({ ok: false, error: { code: 'invalid_rate' } });
    expect(await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'USD', asOfUtcS: JAN, rateE12: E12 })).toMatchObject({ ok: false, error: { code: 'invalid_quote' } });
  });

  it('deletes a custom rate but not a service rate', async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: E12 });
    await h.run(rates.applyRateTable, { fold: h.fold, asOfUtcS: FEB, rates: [{ quote: 'EUR', rateE12: E12 }] });
    expect((await h.run(rates.deleteCustomRate, { fold: h.fold, id: id(30) })).ok).toBe(true);
    expect(await h.run(rates.deleteCustomRate, { fold: h.fold, id: serviceRateId(h.fold, 'EUR', FEB) })).toMatchObject({ ok: false, error: { code: 'not_custom' } });
    expect(await h.run(rates.deleteCustomRate, { fold: h.fold, id: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('applies a published table once, tolerates a bad row, and re-applying changes nothing', async () => {
    const table = [{ quote: 'EUR', rateE12: E12 }, { quote: 'GBP', rateE12: 8n * E12 / 10n }, { quote: 'ZZZ', rateE12: E12 }, { quote: 'JPY', rateE12: 0n }];
    expect(await h.run(rates.applyRateTable, { fold: h.fold, asOfUtcS: JAN, rates: table })).toEqual({ ok: true, value: { stored: 2, skipped: 2 } });
    const before = (await h.replica.oplog.list(h.fold)).length;
    expect(await h.run(rates.applyRateTable, { fold: h.fold, asOfUtcS: JAN, rates: table })).toEqual({ ok: true, value: { stored: 0, skipped: 4 } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
    expect((await h.ledger()).rates.map((r) => r.quote).sort()).toEqual(['EUR', 'GBP']);
  });

  it('prefers the user rate over a service rate for the same instant', async () => {
    await h.run(rates.applyRateTable, { fold: h.fold, asOfUtcS: JAN, rates: [{ quote: 'EUR', rateE12: E12 }] });
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: 2n * E12 });
    const ledger = await h.ledger();
    expect(ledger.rates).toHaveLength(1);
    expect(ledger.rates[0]!.source).toBe('custom');
  });
});

describe('revalue', () => {
  beforeEach(async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(30), quote: 'EUR', asOfUtcS: JAN, rateE12: E12 });
    await spendEur(10, JAN + 100, -1_000n);
    await spendEur(11, FEB, -2_000n);
  });

  it('re-snapshots with current rates only when asked', async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(31), quote: 'EUR', asOfUtcS: FEB, rateE12: 2n * E12 });
    expect((await h.ledger()).transactions.get(id(10))!.baseAmountMinor).toBe(-1_000n);
    h.setNow(MAR * 1000);
    const r = await h.run(revalue(), { fold: h.fold, ids: [id(10), id(11)] });
    expect(r).toEqual({ ok: true, value: { revalued: 2, unchanged: 0, missingRates: [] } });
    const t = (await h.ledger()).transactions;
    expect(t.get(id(10))).toMatchObject({ baseAmountMinor: -500n, fxBaseRateId: null, fxRateId: id(31) });
    expect(t.get(id(11))!.baseAmountMinor).toBe(-1_000n);
  });

  it('can restore the rate that was in force at a chosen time', async () => {
    await h.run(rates.setCustomRate, { fold: h.fold, id: id(31), quote: 'EUR', asOfUtcS: FEB, rateE12: 2n * E12 });
    h.setNow(MAR * 1000);
    await h.run(revalue(), { fold: h.fold, ids: [id(10)] });
    await h.run(revalue(), { fold: h.fold, ids: [id(10)], asOfUtcS: JAN + 100 });
    expect((await h.ledger()).transactions.get(id(10))!.baseAmountMinor).toBe(-1_000n);
  });

  it('writes nothing for a transaction whose snapshot would not change', async () => {
    const before = (await h.replica.oplog.list(h.fold)).length;
    h.setNow(MAR * 1000);
    expect(await h.run(revalue(), { fold: h.fold, ids: [id(10), id(11)] })).toEqual({ ok: true, value: { revalued: 0, unchanged: 2, missingRates: [] } });
    expect(await h.replica.oplog.list(h.fold)).toHaveLength(before);
  });

  it('reports a transaction it cannot revalue instead of guessing', async () => {
    await h.run(rates.deleteCustomRate, { fold: h.fold, id: id(30) });
    const r = await h.run(revalue(), { fold: h.fold, ids: [id(10)] });
    expect(r).toEqual({ ok: true, value: { revalued: 0, unchanged: 0, missingRates: [{ id: id(10), currency: 'EUR' }] } });
    expect((await h.ledger()).transactions.get(id(10))!.baseAmountMinor).toBe(-1_000n);
  });
});
