import IntlMessageFormat from 'intl-messageformat';
import { MESSAGES_EN } from '../errors/catalogue';
import en from './messages/en.json' with { type: 'json' };

// Static-export friendly internationalisation: catalogues are bundled, ICU messages are formatted on the client with
// intl-messageformat, and the locale is chosen from the browser's languages. Adding a language means adding a catalogue
// and listing it in LOCALES; a key missing from a catalogue falls back to English.

export type Catalog = Readonly<Record<string, string>>;
export type Catalogs = Readonly<Partial<Record<string, Catalog>>>;
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export const LOCALES = { en: 'ltr', ar: 'rtl' } as const;
export type Locale = keyof typeof LOCALES;
export const SUPPORTED_LOCALES = Object.keys(LOCALES) as Locale[];
export const DEFAULT_LOCALE: Locale = 'en';

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

/** Bundled catalogues. `ar` is intentionally empty until it is professionally translated: the layout is right-to-left, the words fall back to English. */
export const CATALOGS: Catalogs = { en: { ...MESSAGES_EN, ...en }, ar: {} };

export function directionOf(tag: string): 'ltr' | 'rtl' {
  const language = tag.toLowerCase().split('-')[0] ?? '';
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

export function resolveLocale(preferred: readonly string[] | undefined): Locale {
  for (const tag of preferred ?? []) {
    const language = tag.toLowerCase().split('-')[0] ?? '';
    const match = SUPPORTED_LOCALES.find((l) => l === language);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/** ICU formatting for one locale, with English as the fallback. Never throws. */
export function createTranslator(locale: string, catalogs: Catalogs = CATALOGS): Translate {
  const cache = new Map<string, IntlMessageFormat | null>();
  return (key, params) => {
    const template = catalogs[locale]?.[key] ?? catalogs['en']?.[key];
    if (template === undefined) return key;
    const cacheKey = `${locale}\u0000${key}`;
    let format = cache.get(cacheKey);
    if (format === undefined) {
      try {
        // Latin digits keep what people see consistent with the amounts the app parses.
        format = new IntlMessageFormat(template, `${locale}-u-nu-latn`);
      } catch {
        format = null;
      }
      cache.set(cacheKey, format);
    }
    if (format === null) return key;
    try {
      return String(format.format(params ?? {}));
    } catch {
      return key;
    }
  };
}

/** The decimal and grouping symbols for a locale, with Latin digits, as used to parse and print amounts. */
export function separatorsFor(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(`${locale}-u-nu-latn`).formatToParts(1234567.8);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}
