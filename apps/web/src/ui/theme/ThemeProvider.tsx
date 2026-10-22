'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { resolveTheme, type ResolvedTheme, type ThemeChoice } from './resolve-theme';

interface ThemeApi {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice(choice: ThemeChoice): void;
}

const ThemeContext = createContext<ThemeApi | undefined>(undefined);
const DARK_QUERY = '(prefers-color-scheme: dark)';
const selectTheme = (p: { theme: ThemeChoice }): ThemeChoice => p.theme;

/** Holds the person's theme choice and applies the resolved theme to <html>. In `system` it follows the operating system live (FR-041). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = usePrefs(selectTheme);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    setSystemDark(query.matches);
    if (choice !== 'system') return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  const resolved = resolveTheme(choice, systemDark);
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setChoice = useCallback((next: ThemeChoice) => prefsStore.update((p) => (p.theme === next ? p : { ...p, theme: next })), []);
  const value = useMemo(() => ({ choice, resolved, setChoice }), [choice, resolved, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const api = useContext(ThemeContext);
  if (!api) throw new Error('useTheme needs a ThemeProvider');
  return api;
}
