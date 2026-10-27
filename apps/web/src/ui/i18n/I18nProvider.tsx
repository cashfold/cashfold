'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ShellLanguage } from '@cashfold/platform';
import { isDesktopApp } from '../../adapters/platform/detect';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { CATALOGS, createTranslator, DEFAULT_LOCALE, DESKTOP_VARIANT, directionOf, loadCatalogue, resolveLanguage, type Catalog, type LanguageChoice, type Locale, type Translate } from './i18n';

interface I18n {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly t: Translate;
  /** What the person chose (`auto` follows the browser). */
  readonly language: LanguageChoice;
  readonly setLanguage: (choice: LanguageChoice) => void;
}

const Context = createContext<I18n | null>(null);

const selectLanguage = (p: { language: LanguageChoice }): LanguageChoice => p.language;

/**
 * Chooses the locale after mount (the person's saved choice, else the browser's languages, else English) and keeps <html lang dir> in step.
 * Ukrainian and Polish are separate chunks: until one arrives the words are English, then they swap without losing the page or any input.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const language = usePrefs(selectLanguage);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  // Known after mount, like the locale, so the first client render matches the prerendered page.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktopApp()), []);
  const [loaded, setLoaded] = useState<{ locale: string; catalogue: Catalog } | null>(null);

  useEffect(() => {
    setLocale(resolveLanguage(language, navigator.languages ?? [navigator.language]));
  }, [language]);

  useEffect(() => {
    let current = true;
    void loadCatalogue(locale).then((catalogue) => {
      if (current) setLoaded({ locale, catalogue });
    });
    return () => {
      current = false;
    };
  }, [locale]);

  const setLanguage = useCallback((choice: LanguageChoice) => prefsStore.update((p) => ({ ...p, language: choice })), []);

  const value = useMemo<I18n>(() => {
    // English words until the chosen language has loaded, but the direction and `lang` follow at once.
    const ready = loaded?.locale === locale ? loaded.catalogue : undefined;
    const t = createTranslator(locale, { ...CATALOGS, ...(ready === undefined ? {} : { [locale]: ready }) }, desktop ? DESKTOP_VARIANT : undefined);
    return { locale, dir: directionOf(locale), t, language, setLanguage };
  }, [locale, loaded, language, setLanguage, desktop]);

  useEffect(() => {
    document.documentElement.lang = value.locale;
    document.documentElement.dir = value.dir;
  }, [value.locale, value.dir]);

  // The desktop app's own menus follow the language shown here. The plain web app has no bridge, and the validating code is loaded only where it is used.
  useEffect(() => {
    if (!isDesktopApp() || !['en', 'uk', 'pl'].includes(locale)) return;
    void import('../../adapters/platform').then(({ getDesktopBridge }) => getDesktopBridge()?.setLanguage(locale as ShellLanguage)).catch(() => undefined);
  }, [locale]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (value === null) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
