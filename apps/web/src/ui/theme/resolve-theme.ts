// Pure theme logic shared by the pre-paint script, the ThemeProvider and the tests (FR-041).
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** The localStorage key of the interface preferences (data-model §1); the theme is one field of it. */
export const THEME_KEY = 'cashfold.ui';

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}

/** Reads the stored choice defensively: anything unexpected, or a storage that throws, gives `system`. */
export function parseStoredTheme(source: string | null | undefined | (() => string | null | undefined)): ThemeChoice {
  try {
    const raw = typeof source === 'function' ? source() : source;
    if (typeof raw !== 'string') return 'system';
    const parsed: unknown = JSON.parse(raw);
    const theme = typeof parsed === 'object' && parsed !== null ? (parsed as { theme?: unknown }).theme : undefined;
    return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
  } catch {
    return 'system';
  }
}
