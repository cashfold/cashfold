import IntlMessageFormat from 'intl-messageformat';
import { MESSAGES_EN } from '../errors/catalogue';
import en from './messages/en.json' with { type: 'json' };
import type { LanguageChoice } from '../prefs/schema';
import { PSEUDO_LOCALE, pseudoCatalogue } from './pseudo';

// Static-export friendly internationalisation: catalogues are bundled, ICU messages are formatted on the client with
// intl-messageformat, and the locale is chosen from the browser's languages. Adding a language means adding a catalogue
// and listing it in LOCALES; a key missing from a catalogue falls back to English.

export type Catalog = Readonly<Record<string, string>>;
export type Catalogs = Readonly<Partial<Record<string, Catalog>>>;
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export const LOCALES = { en: 'ltr', uk: 'ltr', pl: 'ltr', ar: 'rtl', 'en-XA': 'ltr' } as const;
export type Locale = keyof typeof LOCALES;
/** The languages people can use: the pseudo-locale (tests only) is not among them. */
export const SUPPORTED_LOCALES = (Object.keys(LOCALES) as Locale[]).filter((l) => l !== PSEUDO_LOCALE);
export const DEFAULT_LOCALE: Locale = 'en';

/** The languages a person can pick by hand, each written in its own language so it can be found from a screen they cannot read. `ar` is a layout-only placeholder, so it is not offered. */
export const LANGUAGE_NAMES = { en: 'English', uk: 'Українська', pl: 'Polski' } as const;
export type SelectableLocale = keyof typeof LANGUAGE_NAMES;
export const SELECTABLE_LOCALES = Object.keys(LANGUAGE_NAMES) as SelectableLocale[];

export type { LanguageChoice };

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

/** English is the source of truth and the fallback for every key, so it ships in the main bundle. */
export const ENGLISH: Catalog = { ...MESSAGES_EN, ...en };

/** Catalogues that need no loading. `ar` is intentionally empty until it is professionally translated: the layout is right-to-left, the words fall back to English. Ukrainian and Polish load on demand (`loadCatalogue`). */
export const CATALOGS: Catalogs = { en: ENGLISH, ar: {}, [PSEUDO_LOCALE]: pseudoCatalogue(ENGLISH) };

/** The catalogue for one locale. Ukrainian and Polish are separate chunks, fetched when first needed (the service worker has them precached, so this works offline). */
export async function loadCatalogue(locale: string): Promise<Catalog> {
  try {
    if (locale === 'uk') return (await import('./messages/uk.json')).default as Catalog;
    if (locale === 'pl') return (await import('./messages/pl.json')).default as Catalog;
  } catch {
    return {}; // the words fall back to English
  }
  return CATALOGS[locale] ?? {};
}

export function directionOf(tag: string): 'ltr' | 'rtl' {
  const language = tag.toLowerCase().split('-')[0] ?? '';
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

export function resolveLocale(preferred: readonly string[] | undefined): Locale {
  for (const tag of preferred ?? []) {
    if (tag === PSEUDO_LOCALE) return PSEUDO_LOCALE; // exact, for the pseudo-locale e2e project only
    const language = tag.toLowerCase().split('-')[0] ?? '';
    const match = SUPPORTED_LOCALES.find((l) => l === language);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/** The locale to use: the person's own choice, or (for `auto`) the first browser language we support. */
export function resolveLanguage(choice: LanguageChoice, browserLanguages: readonly string[] | undefined): Locale {
  return choice === 'auto' ? resolveLocale(browserLanguages) : choice;
}

/** The suffix of a message written for the desktop app: `quick.lede` has `quick.lede.desktop`, where the web's words ("the browser") would be wrong. */
export const DESKTOP_VARIANT = 'desktop';

/**
 * ICU formatting for one locale, with English as the fallback. Never throws. With `variant`, a message that has a `<key>.<variant>` text uses it, in the
 * same language, before falling back to the plain one.
 */
export function createTranslator(locale: string, catalogs: Catalogs = CATALOGS, variant?: string): Translate {
  const cache = new Map<string, IntlMessageFormat | null>();
  return (key, params) => {
    const special = variant === undefined ? undefined : `${key}.${variant}`;
    const template = (special === undefined ? undefined : (catalogs[locale]?.[special] ?? catalogs['en']?.[special])) ?? catalogs[locale]?.[key] ?? catalogs['en']?.[key];
    if (template === undefined) return key;
    const cacheKey = `${locale}\u0000${key}\u0000${variant ?? ''}`;
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
