import { describe, expect, it } from 'vitest';
import { decimalsOf, degreesFromDevice, formatDegrees, formatRate, formatMoney, formatPlain, formatSigned, parseDegrees, parseMoney, parseRateText, percentOf, signOf } from './format';

describe('formatMoney', () => {
  it('stays exact beyond what a double can hold, in any locale', () => {
    expect(formatMoney(9_007_199_254_740_993n, 'USD', 'en')).toBe('90,071,992,547,409.93 USD');
    expect(formatMoney(9_007_199_254_740_993n, 'USD', 'ar')).toMatch(/^[0-9٬,.\u066B]+ USD$/u);
    expect(formatMoney(-9_007_199_254_740_993n, 'USD', 'ar')).toContain('9');
  });

  it('prints exact amounts with the currency\'s own decimals', () => {
    expect(formatMoney(123_456n, 'USD', 'en')).toBe('1,234.56 USD');
    expect(formatMoney(5n, 'USD', 'en')).toBe('0.05 USD');
    expect(formatMoney(1_234n, 'JPY', 'en')).toBe('1,234 JPY');
    expect(formatMoney(1_234_567n, 'KWD', 'en')).toBe('1,234.567 KWD');
  });

  it('uses a real minus sign and keeps amounts above 2^53 exact', () => {
    expect(formatMoney(-450n, 'USD', 'en')).toBe('−4.50 USD');
    expect(formatMoney(2n ** 62n, 'USD', 'en')).toBe('46,116,860,184,273,879.04 USD');
  });

  it('follows the locale\'s separators', () => {
    expect(formatMoney(123_456n, 'EUR', 'de')).toBe('1.234,56 EUR');
  });

  it('marks gains with a plus', () => {
    expect(formatSigned(100n, 'USD', 'en')).toBe('+1.00 USD');
    expect(formatSigned(-100n, 'USD', 'en')).toBe('−1.00 USD');
    expect(formatSigned(0n, 'USD', 'en')).toBe('0.00 USD');
  });

  it('prints plain digits for editing', () => {
    expect(formatPlain(-12_345n, 'USD', 'en')).toBe('-123.45');
    expect(formatPlain(500n, 'JPY', 'en')).toBe('500');
  });

  it('shows an unknown currency honestly instead of guessing its decimals', () => {
    expect(formatMoney(5n, 'ZZZ', 'en')).toBe('5 ZZZ');
    expect(decimalsOf('ZZZ')).toBe(2);
    expect(decimalsOf('JPY')).toBe(0);
  });
});

describe('parseMoney', () => {
  it('reads what was typed exactly', () => {
    expect(parseMoney('1,234.56', 'USD', 'en')).toEqual({ ok: true, value: 123_456n });
    expect(parseMoney('0.1', 'USD', 'en')).toEqual({ ok: true, value: 10n });
    expect(parseMoney('-3', 'USD', 'en')).toEqual({ ok: true, value: -300n });
    expect(parseMoney('1.234,56', 'EUR', 'de')).toEqual({ ok: true, value: 123_456n });
  });

  it('rejects too many decimals instead of rounding', () => {
    expect(parseMoney('1.234', 'USD', 'en')).toMatchObject({ ok: false, error: { code: 'too_many_decimals' } });
    expect(parseMoney('1.5', 'JPY', 'en')).toMatchObject({ ok: false, error: { code: 'too_many_decimals' } });
  });

  it('rejects text that is not an amount, and an unknown currency', () => {
    expect(parseMoney('abc', 'USD', 'en')).toMatchObject({ ok: false, error: { code: 'invalid_format' } });
    expect(parseMoney('1', 'ZZZ', 'en')).toMatchObject({ ok: false, error: { code: 'unknown_currency' } });
  });

  it('keeps large amounts exact and refuses ones beyond 64 bits', () => {
    expect(parseMoney('46116860184273879.04', 'USD', 'en')).toEqual({ ok: true, value: 2n ** 62n });
    expect(parseMoney('92233720368547758.08', 'USD', 'en')).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });
});

describe('parseRateText', () => {
  it('reads a rate to 12 decimal places exactly', () => {
    expect(parseRateText('0.9215', 'en')).toEqual({ ok: true, value: 921_500_000_000n });
    expect(parseRateText('1', 'en')).toEqual({ ok: true, value: 1_000_000_000_000n });
    expect(parseRateText('.5', 'en')).toEqual({ ok: true, value: 500_000_000_000n });
    expect(parseRateText('1,234.5', 'en')).toEqual({ ok: true, value: 1_234_500_000_000_000n });
    expect(parseRateText('0,9215', 'de')).toEqual({ ok: true, value: 921_500_000_000n });
    expect(parseRateText('0.000000000001', 'en')).toEqual({ ok: true, value: 1n });
  });

  it('rejects junk and more precision than is stored', () => {
    for (const bad of ['', 'abc', '1.2.3', '-1', '1e5', '0.0000000000001']) expect(parseRateText(bad, 'en').ok, bad).toBe(false);
    expect(parseRateText('0.0000000000001', 'en')).toMatchObject({ error: { code: 'too_precise' } });
  });
});

describe('small helpers', () => {
  it('classifies a sign for the cue shown next to a number', () => {
    expect([signOf(1n), signOf(-1n), signOf(0n)]).toEqual(['gain', 'loss', 'zero']);
  });

  it('turns a share into a whole percent without floats on the way', () => {
    expect(percentOf(1n, 3n)).toBe(33);
    expect(percentOf(3n, 3n)).toBe(100);
    expect(percentOf(5n, 3n)).toBe(100);
    expect(percentOf(0n, 3n)).toBe(0);
    expect(percentOf(1n, 0n)).toBe(0);
    expect(percentOf(2n ** 62n, 2n ** 63n - 1n)).toBe(50);
  });
});

describe('coordinates', () => {
  it('reads decimal degrees exactly to 10^-7', () => {
    expect(parseDegrees('51.5074', 'en', 90)).toEqual({ ok: true, value: 515_074_000 });
    expect(parseDegrees('-0.1278', 'en', 180)).toEqual({ ok: true, value: -1_278_000 });
    expect(parseDegrees('+12', 'en', 90)).toEqual({ ok: true, value: 120_000_000 });
    expect(parseDegrees('0,5', 'de', 90)).toEqual({ ok: true, value: 5_000_000 });
    expect(parseDegrees('90', 'en', 90)).toEqual({ ok: true, value: 900_000_000 });
  });

  it('rejects junk, more precision than stored, and values outside the globe', () => {
    expect(parseDegrees('abc', 'en', 90)).toMatchObject({ ok: false, error: { code: 'invalid_degrees' } });
    expect(parseDegrees('', 'en', 90)).toMatchObject({ ok: false, error: { code: 'invalid_degrees' } });
    expect(parseDegrees('1.2.3', 'en', 90)).toMatchObject({ ok: false });
    expect(parseDegrees('1.00000001', 'en', 90)).toMatchObject({ ok: false, error: { code: 'too_precise' } });
    expect(parseDegrees('90.0000001', 'en', 90)).toMatchObject({ ok: false, error: { code: 'out_of_bounds' } });
    expect(parseDegrees('-181', 'en', 180)).toMatchObject({ ok: false, error: { code: 'out_of_bounds' } });
  });

  it('prints degrees with only the decimals that matter', () => {
    expect(formatDegrees(515_074_000, 'en')).toBe('51.5074');
    expect(formatDegrees(-1_278_000, 'en')).toBe('-0.1278');
    expect(formatDegrees(120_000_000, 'en')).toBe('12');
    expect(formatDegrees(1, 'en')).toBe('0.0000001');
    expect(formatDegrees(0, 'en')).toBe('0');
    expect(formatDegrees(5_000_000, 'de')).toBe('0,5');
  });

  it('turns a location from the device into the stored integer without arithmetic', () => {
    expect(degreesFromDevice(51.5074)).toBe(515_074_000);
    expect(degreesFromDevice(-0.1278)).toBe(-1_278_000);
    expect(degreesFromDevice(-122.4194)).toBe(-1_224_194_000);
    expect(degreesFromDevice(0)).toBe(0);
    expect(degreesFromDevice(180)).toBe(1_800_000_000);
  });
});

describe('formatRate', () => {
  it('prints a rate with only the decimals that matter', () => {
    expect(formatRate(921_500_000_000n, 'en')).toBe('0.9215');
    expect(formatRate(1_000_000_000_000n, 'en')).toBe('1');
    expect(formatRate(1n, 'en')).toBe('0.000000000001');
    expect(formatRate(150_250_000_000_000n, 'de')).toBe('150,25');
    expect(parseRateText(formatRate(123_456_789_012n, 'en'), 'en')).toEqual({ ok: true, value: 123_456_789_012n });
  });
});

describe('amounts typed in Polish and Ukrainian (FR-007)', () => {
  const TWO_DECIMALS = 123_456n;

  it.each(['pl', 'uk'])('%s: accepts an ordinary space, a no-break space and a narrow no-break space as the thousands mark', (locale) => {
    for (const text of ['1 234,56', '1\u00A0234,56', '1\u202F234,56', '1234,56']) {
      expect(parseMoney(text, 'USD', locale), text).toEqual({ ok: true, value: TWO_DECIMALS });
    }
  });

  it.each(['pl', 'uk'])('%s: accepts a dot as the decimal mark when it cannot be a thousands mark', (locale) => {
    expect(parseMoney('1234.56', 'USD', locale)).toEqual({ ok: true, value: TWO_DECIMALS });
    expect(parseMoney('1 234.56', 'USD', locale)).toEqual({ ok: true, value: TWO_DECIMALS });
    expect(parseMoney('-0.05', 'USD', locale)).toEqual({ ok: true, value: -5n });
  });

  it.each(['pl', 'uk'])('%s: rejects an entry that mixes a dot and a comma', (locale) => {
    expect(parseMoney('1.234,56', 'USD', locale).ok).toBe(false);
    expect(parseMoney('1,234.56', 'USD', locale).ok).toBe(false);
  });

  it.each(['pl', 'uk'])('%s: stays exact beyond 2^53', (locale) => {
    expect(parseMoney('90 071 992 547 409,93', 'USD', locale)).toEqual({ ok: true, value: 9_007_199_254_740_993n });
    expect(parseMoney('90071992547409.93', 'USD', locale)).toEqual({ ok: true, value: 9_007_199_254_740_993n });
  });

  it.each(['pl', 'uk'])('%s: still rejects text that is not an amount and too many decimals', (locale) => {
    expect(parseMoney('12 3 4,56', 'USD', locale).ok).toBe(false);
    expect(parseMoney('abc', 'USD', locale).ok).toBe(false);
    expect(parseMoney('1,234', 'USD', locale).ok).toBe(false);
  });

  it('prints with a comma and a no-break space and reads its own output back', () => {
    for (const locale of ['pl', 'uk']) {
      const printed = formatPlain(9_007_199_254_740_993n, 'USD', locale);
      expect(printed).toMatch(/^[0-9\u00A0\u202F ]+,93$/u);
      expect(parseMoney(printed, 'USD', locale)).toEqual({ ok: true, value: 9_007_199_254_740_993n });
    }
  });

  it('leaves English unchanged: a comma is a thousands mark and a dot the decimal mark', () => {
    expect(parseMoney('1,234.56', 'USD', 'en')).toEqual({ ok: true, value: TWO_DECIMALS });
    expect(parseMoney('1 234.56', 'USD', 'en').ok).toBe(false);
  });
});
