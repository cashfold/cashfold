'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { mirrorPrimaryIcon } from './mirror-icon';
import { mirrorThemeToShell } from './mirror-theme';
import type { PrimaryChoice } from './palette';
import { resolveTheme, type ResolvedTheme, type ThemeChoice } from './resolve-theme';

interface ThemeApi {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice(choice: ThemeChoice): void;
  primary: PrimaryChoice;
  setPrimary(primary: PrimaryChoice): void;
}

const ThemeContext = createContext<ThemeApi | undefined>(undefined);
const DARK_QUERY = '(prefers-color-scheme: dark)';
const selectTheme = (p: { theme: ThemeChoice }): ThemeChoice => p.theme;
const selectPrimary = (p: { primary: PrimaryChoice }): PrimaryChoice => p.primary;

/** Holds the person's theme choice and applies the resolved theme to <html>. In `system` it follows the operating system live (FR-041). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = usePrefs(selectTheme);
  const primary = usePrefs(selectPrimary);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    setSystemDark(query.matches);
    if (choice !== 'system') return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  // In the desktop app the shell is told the choice, so its first frame and its native chrome match.
  useEffect(() => {
    void mirrorThemeToShell(choice);
  }, [choice]);

  const resolved = resolveTheme(choice, systemDark);
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  // The primary colour is the `data-primary` attribute next to `data-theme`; tokens.css does the rest.
  useEffect(() => {
    document.documentElement.dataset['primary'] = primary;
  }, [primary]);

  // The icon follows the colour: the tab, the manifest, and in the desktop app the dock and window.
  useEffect(() => {
    void mirrorPrimaryIcon(primary);
  }, [primary]);

  const setChoice = useCallback((next: ThemeChoice) => prefsStore.update((p) => (p.theme === next ? p : { ...p, theme: next })), []);
  const setPrimary = useCallback((next: PrimaryChoice) => prefsStore.update((p) => (p.primary === next ? p : { ...p, primary: next })), []);
  const value = useMemo(() => ({ choice, resolved, setChoice, primary, setPrimary }), [choice, resolved, setChoice, primary, setPrimary]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const api = useContext(ThemeContext);
  if (!api) throw new Error('useTheme needs a ThemeProvider');
  return api;
}
