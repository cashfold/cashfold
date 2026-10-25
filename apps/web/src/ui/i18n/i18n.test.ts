import { describe, expect, it } from 'vitest';
import { createTranslator, directionOf, LANGUAGE_NAMES, loadCatalogue, resolveLanguage, resolveLocale, SELECTABLE_LOCALES, separatorsFor, SUPPORTED_LOCALES } from './i18n';

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

describe('Ukrainian and Polish', () => {
  it('are picked from the browser\'s languages, by base language', () => {
    expect(resolveLocale(['pl-PL'])).toBe('pl');
    expect(resolveLocale(['uk-UA'])).toBe('uk');
    expect(resolveLocale(['ru', 'pl'])).toBe('pl'); // unsupported languages are skipped
    expect(resolveLocale(['de', 'uk', 'pl'])).toBe('uk'); // the browser's order wins
    expect(resolveLocale(['de'])).toBe('en');
  });

  it('are supported, left to right, and offered under their own names', () => {
    expect(SUPPORTED_LOCALES).toEqual(expect.arrayContaining(['uk', 'pl']));
    expect(directionOf('uk')).toBe('ltr');
    expect(directionOf('pl-PL')).toBe('ltr');
    expect(LANGUAGE_NAMES).toEqual({ en: 'English', uk: 'Українська', pl: 'Polski' });
    expect(SELECTABLE_LOCALES).toEqual(['en', 'uk', 'pl']);
  });

  it('use a space as the thousands mark and a comma as the decimal mark', () => {
    for (const locale of ['uk', 'pl']) {
      const { decimal, group } = separatorsFor(locale);
      expect(decimal).toBe(',');
      expect(group).toMatch(/^[\u00A0\u202F ]$/u);
    }
  });

  it('load as catalogues, and an unknown locale loads as empty', async () => {
    expect(typeof (await loadCatalogue('uk'))).toBe('object');
    expect(typeof (await loadCatalogue('pl'))).toBe('object');
    expect(await loadCatalogue('xx')).toEqual({});
  });

  it('show English for a key the loaded catalogue lacks', () => {
    const t = createTranslator('pl', { en: { a: 'Hello' }, pl: {} });
    expect(t('a')).toBe('Hello');
  });
});

describe('resolveLanguage (the person\'s choice against the browser)', () => {
  it('a saved language wins over the browser', () => {
    expect(resolveLanguage('uk', ['pl'])).toBe('uk');
    expect(resolveLanguage('en', ['pl', 'uk'])).toBe('en');
  });

  it('auto follows the browser, and gives English when nothing matches', () => {
    expect(resolveLanguage('auto', ['pl-PL', 'en'])).toBe('pl');
    expect(resolveLanguage('auto', ['de'])).toBe('en');
    expect(resolveLanguage('auto', undefined)).toBe('en');
  });
});
