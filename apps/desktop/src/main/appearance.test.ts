import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { backgroundColorFor, createAppearance, DARK_BACKGROUND, LIGHT_BACKGROUND, TRANSPARENT } from './appearance';

describe('the window colour', () => {
  it.each([
    ['system', false, LIGHT_BACKGROUND],
    ['system', true, DARK_BACKGROUND],
    ['light', true, LIGHT_BACKGROUND],
    ['light', false, LIGHT_BACKGROUND],
    ['dark', false, DARK_BACKGROUND],
    ['dark', true, DARK_BACKGROUND],
  ] as const)('for theme %s on a system that is dark=%s is %s', (theme, systemDark, expected) => {
    expect(backgroundColorFor(theme, systemDark)).toBe(expected);
  });

  it('is the --bg of the light and the dark theme of the web app, so the first frame matches the page', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'app', 'tokens.css'), 'utf8');
    const bgOf = (theme: string): string | undefined => new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{[^}]*?--bg:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
    expect(bgOf('light')?.toLowerCase()).toBe(LIGHT_BACKGROUND);
    expect(bgOf('dark')?.toLowerCase()).toBe(DARK_BACKGROUND);
  });
});

function setup(stored: 'system' | 'light' | 'dark', systemDark: boolean) {
  let updated: () => void = () => undefined;
  const nativeTheme = {
    themeSource: 'system' as 'system' | 'light' | 'dark',
    systemDark,
    get shouldUseDarkColors() {
      return this.themeSource === 'system' ? this.systemDark : this.themeSource === 'dark';
    },
    on: (_event: 'updated', listener: () => void) => {
      updated = listener;
    },
  };
  let theme = stored;
  const store = { get: () => ({ theme }), update: vi.fn((change: { theme: 'system' | 'light' | 'dark' }) => void (theme = change.theme)) };
  const win = { setBackgroundColor: vi.fn(), isDestroyed: () => false };
  const appearance = createAppearance({ nativeTheme, store });
  return { nativeTheme, store, win, appearance, fire: () => updated(), stored: () => theme };
}

describe('the appearance of the shell', () => {
  it('sets the native theme from the stored choice at start', () => {
    const { nativeTheme, appearance } = setup('dark', false);
    appearance.start();
    expect(nativeTheme.themeSource).toBe('dark');
  });

  it('gives the window the colour of the stored choice, whatever the system says', () => {
    const light = setup('light', true);
    light.appearance.start();
    expect(light.appearance.backgroundColor()).toBe(LIGHT_BACKGROUND);
    const dark = setup('dark', false);
    dark.appearance.start();
    expect(dark.appearance.backgroundColor()).toBe(DARK_BACKGROUND);
    const system = setup('system', true);
    system.appearance.start();
    expect(system.appearance.backgroundColor()).toBe(DARK_BACKGROUND);
  });

  it('stores a new choice, applies it to the native theme and recolours the window', () => {
    const { nativeTheme, store, win, appearance } = setup('system', false);
    appearance.start();
    appearance.attach(win as never);
    appearance.set('dark');
    expect(store.update).toHaveBeenCalledWith({ theme: 'dark' });
    expect(nativeTheme.themeSource).toBe('dark');
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(DARK_BACKGROUND);
  });

  it('does not write the file when the choice is the one already stored', () => {
    const { store, appearance } = setup('light', false);
    appearance.start();
    appearance.set('light');
    expect(store.update).not.toHaveBeenCalled();
  });

  it('follows the system under "system": the window is recoloured when the native theme updates', () => {
    const { nativeTheme, win, appearance, fire } = setup('system', false);
    appearance.start();
    appearance.attach(win as never);
    nativeTheme.systemDark = true;
    fire();
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(DARK_BACKGROUND);
    nativeTheme.systemDark = false;
    fire();
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(LIGHT_BACKGROUND);
  });

  it('leaves a window that is gone alone', () => {
    const { win, appearance, fire } = setup('system', false);
    appearance.start();
    appearance.attach({ ...win, isDestroyed: () => true } as never);
    expect(() => fire()).not.toThrow();
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
  });
});

describe('a translucent window', () => {
  it('has no colour of its own while a material is on, and its colour back when it is off', () => {
    const { win, appearance } = setup('dark', false);
    appearance.start();
    appearance.attach(win as never);
    appearance.setTransparent(true);
    expect(appearance.backgroundColor()).toBe(TRANSPARENT);
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(TRANSPARENT);
    appearance.setTransparent(false);
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(DARK_BACKGROUND);
  });

  it('keeps it transparent through a theme change', () => {
    const { win, appearance, fire, nativeTheme } = setup('system', false);
    appearance.start();
    appearance.attach(win as never);
    appearance.setTransparent(true);
    nativeTheme.systemDark = true;
    fire();
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith(TRANSPARENT);
  });
});

describe('telling others about a change', () => {
  it('says whether the dark colours are in use, for the window buttons the shell draws', () => {
    const light = setup('light', true);
    light.appearance.start();
    expect(light.appearance.isDark()).toBe(false);
    const dark = setup('dark', false);
    dark.appearance.start();
    expect(dark.appearance.isDark()).toBe(true);
    const system = setup('system', true);
    system.appearance.start();
    expect(system.appearance.isDark()).toBe(true);
  });

  it('calls a listener when the theme changes, and when the system theme changes under "system"', () => {
    const { appearance, fire } = setup('system', false);
    const listener = vi.fn();
    appearance.start();
    appearance.onChange(listener);
    appearance.set('dark');
    fire();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

