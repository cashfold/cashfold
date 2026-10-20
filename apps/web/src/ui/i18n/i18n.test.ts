import { describe, expect, it } from 'vitest';
import { createTranslator, directionOf, resolveLocale, separatorsFor, SUPPORTED_LOCALES } from './i18n';

describe('resolveLocale', () => {
  it('picks the first preferred language we support, matching on language', () => {
    expect(resolveLocale(['en-GB'])).toBe('en');
    expect(resolveLocale(['de-DE', 'ar-EG', 'en'])).toBe('ar');
    expect(resolveLocale(['xx', 'en-US'])).toBe('en');
  });

  it('falls back to English for nothing, garbage, or unsupported languages', () => {
    expect(resolveLocale([])).toBe('en');
    expect(resolveLocale(['', '??', 'tlh'])).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('only ever returns a supported locale', () => {
    for (const tag of ['en', 'ar', 'ar-SA', 'EN', 'zh-Hans-CN', 'fr-CA']) expect(SUPPORTED_LOCALES).toContain(resolveLocale([tag]));
  });
});

describe('directionOf', () => {
  it.each([['en', 'ltr'], ['de', 'ltr'], ['ar', 'rtl'], ['ar-EG', 'rtl'], ['he', 'rtl'], ['fa', 'rtl'], ['ur', 'rtl'], ['ps', 'rtl']] as const)('%s is %s', (tag, dir) => {
    expect(directionOf(tag)).toBe(dir);
  });
});

describe('createTranslator', () => {
  const catalogs = {
    en: { greet: 'Hello', files: '{count, plural, one {# file} other {# files}}', onlyEnglish: 'English only.' },
    ar: { greet: 'مرحبا' },
  };

  it('formats ICU messages, including plurals', () => {
    const t = createTranslator('en', catalogs);
    expect(t('greet')).toBe('Hello');
    expect(t('files', { count: 1 })).toBe('1 file');
    expect(t('files', { count: 3 })).toBe('3 files');
  });

  it('uses the locale catalogue and falls back to English for keys it lacks', () => {
    const t = createTranslator('ar', catalogs);
    expect(t('greet')).toBe('مرحبا');
    expect(t('onlyEnglish')).toBe('English only.');
  });

  it('never throws: an unknown key yields a harmless placeholder, a malformed message yields the key', () => {
    const t = createTranslator('en', { en: { broken: '{count, plural, one {# file}' } });
    expect(t('missing')).toBe('missing');
    expect(t('broken', { count: 1 })).toBe('broken');
  });

  it('keeps Latin digits for numbers inside messages in every locale (amounts are parsed as ASCII)', () => {
    const t = createTranslator('ar', { ar: { n: '{count, number}' }, en: {} });
    expect(t('n', { count: 1234 })).toMatch(/^[0-9٬,.\s ]+$/);
    expect(t('n', { count: 1234 })).not.toMatch(/[٠-٩]/);
  });
});

describe('separatorsFor (decimal and grouping symbols that amount parsing and formatting use)', () => {
  it.each([
    ['en', '.', ','],
    ['de', ',', '.'],
    ['fr', ',', ' '],
    ['ar', '.', ','], // with Latin digits (-u-nu-latn) Arabic uses the same symbols as English
  ] as const)('%s', (locale, decimal, group) => {
    expect(separatorsFor(locale)).toEqual({ decimal, group });
  });
});
