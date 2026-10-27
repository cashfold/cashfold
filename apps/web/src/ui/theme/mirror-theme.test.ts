import { describe, expect, it, vi } from 'vitest';
import { mirrorThemeToShell } from './mirror-theme';

// The page owns the theme choice; in the desktop app it tells the shell, so the window's first frame and the native chrome match (spec 006, FR-007).
const desktopHost = () => ({
  cashfoldDesktop: {
    about: () => undefined,
    revealDataFolder: () => undefined,
    updates: { state: 0, check: 0, download: 0, install: 0, openReleasePage: 0, autoCheck: 0, setAutoCheck: 0, onChange: 0 },
  },
});
const shapedLikeTheBridge = () => {
  const host = desktopHost();
  const fn = () => undefined;
  host.cashfoldDesktop.updates = Object.fromEntries(Object.keys(host.cashfoldDesktop.updates).map((key) => [key, fn])) as never;
  return host;
};

describe('telling the shell the theme', () => {
  it('sends the choice to the bridge in the desktop app', async () => {
    const setTheme = vi.fn<(choice: string) => Promise<undefined>>(async () => undefined);
    await mirrorThemeToShell('dark', shapedLikeTheBridge(), async () => ({ setTheme }) as never);
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('sends every change, including the first value at start', async () => {
    const setTheme = vi.fn<(choice: string) => Promise<undefined>>(async () => undefined);
    const host = shapedLikeTheBridge();
    for (const choice of ['system', 'light', 'dark'] as const) await mirrorThemeToShell(choice, host, async () => ({ setTheme }) as never);
    expect(setTheme.mock.calls.map(([choice]) => choice)).toEqual(['system', 'light', 'dark']);
  });

  it('never loads or calls the bridge in a browser', async () => {
    const load = vi.fn(async () => undefined);
    await mirrorThemeToShell('dark', {}, load as never);
    expect(load).not.toHaveBeenCalled();
  });

  it('is not an error when the shell cannot be reached', async () => {
    await expect(mirrorThemeToShell('dark', shapedLikeTheBridge(), async () => { throw new Error('gone'); })).resolves.toBeUndefined();
    await expect(mirrorThemeToShell('dark', shapedLikeTheBridge(), async () => undefined)).resolves.toBeUndefined();
  });
});
