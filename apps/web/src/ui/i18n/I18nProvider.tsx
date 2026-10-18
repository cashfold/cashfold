'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTranslator, DEFAULT_LOCALE, directionOf, resolveLocale, type Locale, type Translate } from './i18n';

interface I18n {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly t: Translate;
}

const Context = createContext<I18n | null>(null);

/** Chooses the locale from the browser's languages after mount and keeps <html lang dir> in step. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocale(resolveLocale(navigator.languages ?? [navigator.language]));
  }, []);

  const value = useMemo<I18n>(() => ({ locale, dir: directionOf(locale), t: createTranslator(locale) }), [locale]);

  useEffect(() => {
    document.documentElement.lang = value.locale;
    document.documentElement.dir = value.dir;
  }, [value]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (value === null) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
