import { beforeEach, describe, expect, it } from 'vitest';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createRefreshRates, parseRateText, type PublishedRates, type RatesSourcePort } from './refresh-rates';
import { serviceRateId } from './rate-commands';

const E12 = 10n ** 12n;
let h: LedgerHarness;
const table = (rates: Record<string, string>, asOf = '2026-03-01T00:00:00.000Z'): PublishedRates => ({ base: 'USD', asOf, source: 'ecb', rates });
const source = (answer: ReturnType<RatesSourcePort['fetch']>): RatesSourcePort & { calls: number } => {
  const s = { calls: 0, fetch: () => { s.calls++; return answer; } };
  return s;
};

beforeEach(async () => {
  h = await ledgerHarness({ baseCurrency: 'USD' });
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2025, 1, 1) });
});

describe('parseRateText: decimal text to a scaled integer, never through a float', () => {
  it.each([
    ['0.9137', 913_700_000_000n], ['1', E12], ['151.5', 151_500_000_000_000n], ['0.000000000001', 1n],
    ['0.0000000000015', 2n], ['0.0000000000025', 2n], ['0.0000000000026', 3n], // beyond twelve places: half to even
    ['0.123456789012999999', 123_456_789_013n],
    ['9223372.036854775807', 9_223_372_036_854_775_807n],
  ] as const)('%s', (text, expected) => {
    expect(parseRateText(text)).toBe(expected);
  });

  it.each(['', '-1', '1e3', '.5', '5.', '0', '0.0', 'NaN', '1,5', ' 1', '1 ', '0x10', '9223372.036854775808', '0.0000000000005'])('refuses %j', (text) => {
    expect(parseRateText(text)).toBeUndefined();
  });
});

describe('refreshRates (FR-042, FR-103)', () => {
  it('stores each published rate as a service rate dated by the table', async () => {
    const refresh = createRefreshRates({ source: source(Promise.resolve({ ok: true, table: table({ EUR: '0.9137', JPY: '151.5' }) })) });
    const r = await h.run(refresh, { fold: h.fold });
    expect(r).toMatchObject({ ok: true, value: { status: 'updated', stored: 2, skipped: 0 } });
    const asOf = Date.UTC(2026, 2, 1) / 1000;
    const rates = (await h.ledger()).rates;
    expect(rates.map((x) => [x.quote, x.rateE12, x.source, x.asOfUtcS]).sort()).toEqual([['EUR', 913_700_000_000n, 'service', asOf], ['JPY', 151_500_000_000_000n, 'service', asOf]]);
    expect(rates.find((x) => x.quote === 'EUR')!.id).toBe(serviceRateId(h.fold, 'EUR', asOf));
  });

  it('is idempotent: the same table again changes nothing', async () => {
    const refresh = createRefreshRates({ source: source(Promise.resolve({ ok: true, table: table({ EUR: '0.9' }) })) });
    await h.run(refresh, { fold: h.fold });
    const again = await h.run(refresh, { fold: h.fold });
    expect(again).toMatchObject({ ok: true, value: { status: 'updated', stored: 0, skipped: 1 } });
    expect((await h.ledger()).rates).toHaveLength(1);
  });

  it('works offline from the last values: an unreachable service changes nothing and is not an error', async () => {
    await h.run(createRefreshRates({ source: source(Promise.resolve({ ok: true, table: table({ EUR: '0.9' }) })) }), { fold: h.fold });
    const r = await h.run(createRefreshRates({ source: source(Promise.resolve({ ok: false, reason: 'offline' })) }), { fold: h.fold });
    expect(r).toMatchObject({ ok: true, value: { status: 'unavailable', reason: 'offline' } });
    expect((await h.ledger()).rates).toHaveLength(1);
  });

  it('reports a service that publishes no table', async () => {
    const r = await h.run(createRefreshRates({ source: source(Promise.resolve({ ok: false, reason: 'not_published' })) }), { fold: h.fold });
    expect(r).toMatchObject({ ok: true, value: { status: 'unavailable', reason: 'not_published' } });
  });

  it('skips rows it cannot use and keeps the rest', async () => {
    const refresh = createRefreshRates({ source: source(Promise.resolve({ ok: true, table: table({ EUR: '0.9', XXX1: '2', GBP: 'abc', USD: '1', CHF: '0' }) })) });
    const r = await h.run(refresh, { fold: h.fold });
    expect(r).toMatchObject({ ok: true, value: { status: 'updated', stored: 1, skipped: 4 } });
  });

  it('refuses a table whose date is not valid or whose base is not USD', async () => {
    const badDate = await h.run(createRefreshRates({ source: source(Promise.resolve({ ok: true, table: table({ EUR: '0.9' }, 'yesterday') })) }), { fold: h.fold });
    expect(badDate).toMatchObject({ ok: true, value: { status: 'unavailable', reason: 'invalid' } });
    const eur = await h.run(createRefreshRates({ source: source(Promise.resolve({ ok: true, table: { ...table({ EUR: '0.9' }), base: 'EUR' } })) }), { fold: h.fold });
    expect(eur).toMatchObject({ ok: true, value: { status: 'unavailable', reason: 'invalid' } });
    expect((await h.ledger()).rates).toHaveLength(0);
  });

  it('asks the service once per refresh and needs editor rights to write', async () => {
    const s = source(Promise.resolve({ ok: true, table: table({ EUR: '0.9' }) }));
    h.setRole('viewer');
    const r = await h.run(createRefreshRates({ source: s }), { fold: h.fold });
    expect(r).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(s.calls).toBe(0);
  });
});
