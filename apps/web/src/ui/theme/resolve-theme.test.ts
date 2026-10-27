import { describe, expect, it } from 'vitest';
import { THEME_KEY, parseStoredTheme, resolveTheme } from './resolve-theme';

describe('resolveTheme', () => {
  it('follows the system in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('lets an explicit choice win over the system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('parseStoredTheme', () => {
  const store = (value: unknown) => JSON.stringify({ v: 1, theme: value });
  it('reads a valid choice', () => {
    expect(parseStoredTheme(store('dark'))).toBe('dark');
    expect(parseStoredTheme(store('light'))).toBe('light');
    expect(parseStoredTheme(store('system'))).toBe('system');
  });
  it.each([null, undefined, '', 'not json', '[]', '"dark"', store('purple'), store(3), JSON.stringify({ v: 1 })])('falls back to system for %j', (raw) => {
    expect(parseStoredTheme(raw as string | null)).toBe('system');
  });
  it('falls back to system when reading the storage throws', () => {
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(parseStoredTheme(() => throwing.getItem())).toBe('system');
  });
  it('uses the same storage key as the preference store', () => {
    expect(THEME_KEY).toBe('cashfold.ui');
  });
});

describe('the pre-paint bootstrap script', () => {
  async function run(stored: string | null, systemDark: boolean, throwing = false): Promise<{ theme: string | undefined; scheme: string }> {
    const { THEME_BOOTSTRAP } = await import('./bootstrap');
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
    const localStorage = { getItem: () => { if (throwing) throw new Error('denied'); return stored; } };
    const window = { matchMedia: () => ({ matches: systemDark }) };
    new Function('document', 'localStorage', 'window', THEME_BOOTSTRAP)({ documentElement }, localStorage, window);
    return { theme: documentElement.dataset['theme'], scheme: documentElement.style.colorScheme };
  }
  const cases: Array<[string | null, boolean, boolean]> = [
    [null, true, false], [null, false, false], ['{"v":1,"theme":"dark"}', false, false], ['{"v":1,"theme":"light"}', true, false],
    ['{"v":1,"theme":"system"}', true, false], ['garbage', true, false], ['{"theme":"purple"}', true, false], [null, true, true],
  ];
  it.each(cases)('agrees with resolveTheme for %j (system dark: %s, storage throws: %s)', async (stored, systemDark, throwing) => {
    const expected = resolveTheme(parseStoredTheme(throwing ? () => { throw new Error('denied'); } : stored), systemDark);
    expect(await run(stored, systemDark, throwing)).toEqual({ theme: expected, scheme: expected });
  });
});

describe('the pre-paint bootstrap script in the desktop app', () => {
  async function marks(bridge: unknown): Promise<Record<string, string>> {
    const { THEME_BOOTSTRAP } = await import('./bootstrap');
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
    new Function('document', 'localStorage', 'window', THEME_BOOTSTRAP)({ documentElement }, { getItem: () => null }, { matchMedia: () => ({ matches: false }), cashfoldDesktop: bridge });
    const { theme, ...rest } = documentElement.dataset;
    void theme;
    return rest;
  }

  it('marks the platform and the app\'s own bar on macOS and Windows, so the layout is right on the first paint', async () => {
    expect(await marks({ platform: 'darwin' })).toEqual({ platform: 'darwin', frame: 'bar' });
    expect(await marks({ platform: 'win32' })).toEqual({ platform: 'win32', frame: 'bar' });
  });

  it('marks the system frame on Linux', async () => {
    expect(await marks({ platform: 'linux' })).toEqual({ platform: 'linux', frame: 'system' });
  });

  it('marks nothing in a browser, or for a bridge that is not what it should be', async () => {
    expect(await marks(undefined)).toEqual({});
    expect(await marks({ platform: 7 })).toEqual({});
    expect(await marks(null)).toEqual({});
  });
});

