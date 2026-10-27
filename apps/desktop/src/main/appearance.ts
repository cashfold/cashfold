import type { BrowserWindow, NativeTheme } from 'electron';
import type { ThemeRequest } from '@cashfold/platform';

type Theme = ThemeRequest['theme'];

// The colour the window shows before the page has painted: the web app's `--bg` in each theme (apps/web/src/app/tokens.css; appearance.test.ts
// fails if they drift apart). With it a dark system gets a dark window from the first frame, with no white flash.
export const LIGHT_BACKGROUND = '#ffffff';
export const DARK_BACKGROUND = '#09090b';
export const TRANSPARENT = '#00000000';

export const backgroundColorFor = (theme: Theme, systemDark: boolean): string => ((theme === 'system' ? systemDark : theme === 'dark') ? DARK_BACKGROUND : LIGHT_BACKGROUND);

export interface Appearance {
  /** Applies the stored choice to the native theme. Call before the window is created. */
  start(): void;
  /** The colour a new window should open with. */
  backgroundColor(): string;
  /** A new choice from the page: stored, applied to the native theme, and shown on the window. */
  set(theme: Theme): void;
  /** The window to keep in the right colour; it follows the system under "system". */
  attach(win: BrowserWindow): void;
  /** Whether the colour in use is the dark one (for the window controls the shell draws). */
  isDark(): boolean;
  /** A translucent window (vibrancy, Mica) must have no colour of its own, or the material would be covered. */
  setTransparent(on: boolean): void;
  /** Called after the theme or the system theme changed and the window was recoloured. */
  onChange(listener: () => void): void;
}

export function createAppearance(deps: {
  readonly nativeTheme: Pick<NativeTheme, 'themeSource' | 'shouldUseDarkColors'> & { on(event: 'updated', listener: () => void): unknown };
  readonly store: { get(): { readonly theme: Theme }; update(change: { theme: Theme }): void };
}): Appearance {
  const { nativeTheme, store } = deps;
  let window: BrowserWindow | undefined;
  let transparent = false;
  const listeners: Array<() => void> = [];
  // Under "system" the native theme says whether the system is dark; a chosen theme wins over it.
  const isDark = (): boolean => (store.get().theme === 'system' ? nativeTheme.shouldUseDarkColors : store.get().theme === 'dark');
  const backgroundColor = (): string => (transparent ? TRANSPARENT : backgroundColorFor(store.get().theme, nativeTheme.shouldUseDarkColors));
  const paint = (): void => {
    if (window !== undefined && !window.isDestroyed()) window.setBackgroundColor(backgroundColor());
    listeners.forEach((listener) => listener());
  };
  return {
    start() {
      nativeTheme.themeSource = store.get().theme;
      nativeTheme.on('updated', paint);
    },
    backgroundColor,
    set(theme) {
      if (store.get().theme !== theme) store.update({ theme });
      nativeTheme.themeSource = theme;
      paint();
    },
    attach(win) {
      window = win;
      paint();
    },
    isDark,
    setTransparent(on) {
      transparent = on;
      paint();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
