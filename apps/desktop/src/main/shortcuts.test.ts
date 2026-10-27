import { describe, expect, it, vi } from 'vitest';
import { installShortcuts, matchShortcut, SHORTCUTS, type ShortcutEntry, type ShortcutInput } from './shortcuts';

const press = (key: string, mods: Partial<Omit<ShortcutInput, 'key'>> = {}): ShortcutInput => ({ key, control: false, meta: false, shift: false, alt: false, ...mods });

describe('the shortcut table', () => {
  it('does the clipboard and undo shortcuts on macOS, where nothing else would', () => {
    const cases: Array<[string, boolean, string]> = [['z', false, 'undo'], ['z', true, 'redo'], ['x', false, 'cut'], ['c', false, 'copy'], ['v', false, 'paste'], ['a', false, 'select-all']];
    for (const [key, shift, action] of cases) expect(matchShortcut(press(key, { meta: true, shift }), 'darwin')?.action).toBe(action);
  });

  it('leaves the clipboard and undo shortcuts to the page on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      for (const key of ['z', 'x', 'c', 'v', 'a']) expect(matchShortcut(press(key, { control: true }), platform)).toBeUndefined();
    }
  });

  it('uses Command on macOS and Control elsewhere for the window and zoom shortcuts', () => {
    expect(matchShortcut(press('w', { meta: true }), 'darwin')?.action).toBe('close');
    expect(matchShortcut(press('w', { control: true }), 'darwin')).toBeUndefined();
    expect(matchShortcut(press('w', { control: true }), 'win32')?.action).toBe('close');
    expect(matchShortcut(press('w', { meta: true }), 'linux')).toBeUndefined();
    expect(matchShortcut(press('m', { meta: true }), 'darwin')?.action).toBe('minimize');
    expect(matchShortcut(press('0', { control: true }), 'linux')?.action).toBe('zoom-reset');
    expect(matchShortcut(press('=', { control: true, shift: true }), 'linux')?.action).toBe('zoom-in');
    expect(matchShortcut(press('+', { meta: true }), 'darwin')?.action).toBe('zoom-in');
    expect(matchShortcut(press('-', { control: true }), 'win32')?.action).toBe('zoom-out');
  });

  it('toggles full screen with F11, or Control+Command+F on macOS', () => {
    expect(matchShortcut(press('F11'), 'win32')?.action).toBe('toggle-fullscreen');
    expect(matchShortcut(press('F11'), 'darwin')).toBeUndefined();
    expect(matchShortcut(press('f', { control: true, meta: true }), 'darwin')?.action).toBe('toggle-fullscreen');
  });

  it('quits with Control+Q off macOS, and leaves Command+Q to the application menu on macOS', () => {
    expect(matchShortcut(press('q', { control: true }), 'linux')?.action).toBe('quit');
    expect(matchShortcut(press('q', { meta: true }), 'darwin')).toBeUndefined();
  });

  it('knows reload and developer tools only in an unpackaged run', () => {
    expect(matchShortcut(press('r', { control: true }), 'linux')).toBeUndefined();
    expect(matchShortcut(press('r', { control: true }), 'linux', true)?.action).toBe('reload');
    expect(matchShortcut(press('F12'), 'win32', true)?.action).toBe('toggle-devtools');
    expect(matchShortcut(press('F12'), 'win32')).toBeUndefined();
  });

  it('ignores anything it does not own, and presses with an extra modifier', () => {
    expect(matchShortcut(press('k', { control: true }), 'linux')).toBeUndefined();
    expect(matchShortcut(press('w', { control: true, alt: true }), 'linux')).toBeUndefined();
    expect(matchShortcut(press('w'), 'linux')).toBeUndefined();
  });

  it('has no two entries on the same keys on one platform', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const seen = new Set<string>();
      for (const entry of SHORTCUTS.filter((e) => e.platforms === 'all' || (e.platforms === 'mac') === (platform === 'darwin'))) {
        for (const key of entry.keys) {
          const id = `${entry.modifier}+${entry.shift}+${key}`;
          expect(seen.has(id), `${platform} ${id}`).toBe(false);
          seen.add(id);
        }
      }
    }
  });
});

describe('installShortcuts', () => {
  function setup(locked: boolean, table?: readonly ShortcutEntry[]) {
    let handler: (event: { preventDefault(): void }, input: ShortcutInput & { type: string }) => void = () => undefined;
    const contents = { on: (_e: string, h: typeof handler) => { handler = h; }, copy: vi.fn(), setZoomLevel: vi.fn(), getZoomLevel: () => 0, undo: vi.fn(), reload: vi.fn() };
    const win = { close: vi.fn(), minimize: vi.fn(), isFullScreen: () => false, setFullScreen: vi.fn() };
    const quit = vi.fn();
    const sendAction = vi.fn();
    installShortcuts(contents as never, win as never, { platform: 'darwin', development: false, pageLocked: () => locked, quit, sendAction, ...(table === undefined ? {} : { table }) });
    const send = (input: ShortcutInput & { type?: string }) => {
      const event = { preventDefault: vi.fn() };
      handler(event, { type: 'keyDown', ...input });
      return event.preventDefault.mock.calls.length > 0;
    };
    return { contents, win, quit, sendAction, send };
  }

  it('does a handled press and keeps it from the page', () => {
    const { contents, win, send } = setup(false);
    expect(send(press('c', { meta: true }))).toBe(true);
    expect(contents.copy).toHaveBeenCalledOnce();
    expect(send(press('w', { meta: true }))).toBe(true);
    expect(win.close).toHaveBeenCalledOnce();
  });

  it('still does clipboard and window shortcuts while the page is locked, because they are not data actions', () => {
    const { contents, send } = setup(true);
    send(press('c', { meta: true }));
    expect(contents.copy).toHaveBeenCalledOnce();
  });

  it('drops an entry flagged as a data action while the page is locked, and does it once unlocked', () => {
    const table: readonly ShortcutEntry[] = [{ keys: ['n'], modifier: 'primary', shift: false, platforms: 'all', action: 'reload', data: true }];
    const locked = setup(true, table);
    expect(locked.send(press('n', { meta: true }))).toBe(true);
    expect(locked.contents.reload).not.toHaveBeenCalled();
    const open = setup(false, table);
    open.send(press('n', { meta: true }));
    expect(open.contents.reload).toHaveBeenCalledOnce();
  });

  it('sends the page the action id when unlocked', () => {
    const { sendAction, send } = setup(false);
    expect(send(press('n', { meta: true }))).toBe(true);
    expect(sendAction).toHaveBeenCalledWith('new-transaction');
  });

  it('holds back data actions while locked, but still sends lock', () => {
    const { sendAction, send } = setup(true);
    expect(send(press('n', { meta: true }))).toBe(true);
    expect(send(press('f', { meta: true }))).toBe(true);
    expect(sendAction).not.toHaveBeenCalled();
    send(press('l', { meta: true }));
    expect(sendAction).toHaveBeenCalledWith('lock');
  });

  it('passes through key releases and unknown presses untouched', () => {
    const { contents, send } = setup(false);
    expect(send({ ...press('c', { meta: true }), type: 'keyUp' })).toBe(false);
    expect(send(press('k', { meta: true }))).toBe(false);
    expect(contents.copy).not.toHaveBeenCalled();
  });
});

// The accelerators of contracts/menu-and-shortcuts.md, as (action id, key, shift). The primary modifier is Command on macOS and Control elsewhere.
const CONTRACT: ReadonlyArray<readonly [string, string, boolean]> = [
  ['new-transaction', 'n', false],
  ['lock', 'l', false],
  ['settings', ',', false],
  ['search', 'f', false],
  ['go:overview', '1', false],
  ['go:transactions', '2', false],
  ['go:accounts', '3', false],
  ['go:plan', '4', false],
  ['go:settings', '5', false],
  ['import', 'i', true],
  ['export', 'e', true],
];

describe('the app-action shortcuts of the contract', () => {
  it.each(CONTRACT)('%s is %s (shift %s) with the primary modifier on every system', (action, key, shift) => {
    expect(matchShortcut(press(key, { meta: true, shift }), 'darwin')?.action).toBe(action);
    expect(matchShortcut(press(key, { control: true, shift }), 'win32')?.action).toBe(action);
    expect(matchShortcut(press(key, { control: true, shift }), 'linux')?.action).toBe(action);
    expect(matchShortcut(press(key, { control: true, shift }), 'darwin')).toBeUndefined();
  });

  it('flags every action that reaches data, and only lock works while locked', () => {
    for (const [action] of CONTRACT) {
      const entry = SHORTCUTS.find((e) => e.action === action);
      expect(entry?.data === true, action).toBe(action !== 'lock');
    }
  });

  it('has exactly the contract entries and no other app action', () => {
    const appActions = SHORTCUTS.filter((e) => e.action === 'lock' || e.action.includes(':') || ['new-transaction', 'settings', 'search', 'import', 'export'].includes(e.action));
    expect(appActions.map((e) => e.action).sort()).toEqual(CONTRACT.map(([action]) => action).sort());
  });

  it('uses no Alt combination and no key on two entries (a clash is found by the duplicate check above)', () => {
    expect(SHORTCUTS.every((entry) => !entry.keys.some((key) => key.toLowerCase().includes('alt')))).toBe(true);
  });

  it('keeps full screen on Control+Command+F distinct from search on Command+F', () => {
    expect(matchShortcut(press('f', { meta: true, control: true }), 'darwin')?.action).toBe('toggle-fullscreen');
    expect(matchShortcut(press('f', { meta: true }), 'darwin')?.action).toBe('search');
  });
});
