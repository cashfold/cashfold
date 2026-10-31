import type { BrowserWindow, WebContents } from 'electron';
import type { ActionId } from '@cashfold/platform';

// The keyboard shortcuts the application menu used to carry. With no menu bar they live here, in one table, run on the window's key presses.
// Chromium already does clipboard and undo on Windows and Linux; macOS gets them only from an Edit menu, so on macOS they are done explicitly.
// The app-action shortcuts (new transaction, lock, ...) of spec 006 are in this table too: choosing one sends the page its action id (the closed set in
// packages/platform), and every one that reaches data is flagged `data: true`, so it is ignored while the page is locked.

export type ShortcutAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'close'
  | 'minimize'
  | 'toggle-fullscreen'
  | 'quit'
  | 'reload'
  | 'toggle-devtools';

/** The app actions that have a shortcut. */
export type AppShortcutAction = Extract<ActionId, 'new-transaction' | 'lock' | 'settings' | 'search' | 'palette' | 'privacy' | 'import' | 'export' | `go:${string}`>;

export interface ShortcutInput {
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface ShortcutEntry {
  readonly keys: readonly string[];
  /** `primary` is Command on macOS and Control elsewhere; `both` is Control plus Command; `none` is a bare key. */
  readonly modifier: 'primary' | 'both' | 'none';
  readonly shift: boolean | 'any';
  readonly platforms: 'all' | 'mac' | 'other';
  readonly action: ShortcutAction | AppShortcutAction;
  /** An action that reaches the person's data: ignored while the page is locked. */
  readonly data?: true;
  /** Only in an unpackaged run. */
  readonly development?: true;
}

export const SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: ['z'], modifier: 'primary', shift: false, platforms: 'mac', action: 'undo' },
  { keys: ['z'], modifier: 'primary', shift: true, platforms: 'mac', action: 'redo' },
  { keys: ['x'], modifier: 'primary', shift: false, platforms: 'mac', action: 'cut' },
  { keys: ['c'], modifier: 'primary', shift: false, platforms: 'mac', action: 'copy' },
  { keys: ['v'], modifier: 'primary', shift: false, platforms: 'mac', action: 'paste' },
  { keys: ['a'], modifier: 'primary', shift: false, platforms: 'mac', action: 'select-all' },
  { keys: ['+', '='], modifier: 'primary', shift: 'any', platforms: 'all', action: 'zoom-in' },
  { keys: ['-', '_'], modifier: 'primary', shift: 'any', platforms: 'all', action: 'zoom-out' },
  { keys: ['0'], modifier: 'primary', shift: false, platforms: 'all', action: 'zoom-reset' },
  { keys: ['w'], modifier: 'primary', shift: false, platforms: 'all', action: 'close' },
  { keys: ['m'], modifier: 'primary', shift: false, platforms: 'all', action: 'minimize' },
  { keys: ['f'], modifier: 'both', shift: false, platforms: 'mac', action: 'toggle-fullscreen' },
  { keys: ['f11'], modifier: 'none', shift: false, platforms: 'other', action: 'toggle-fullscreen' },
  // On macOS Command+Q belongs to the application menu.
  { keys: ['q'], modifier: 'primary', shift: false, platforms: 'other', action: 'quit' },
  { keys: ['r'], modifier: 'primary', shift: false, platforms: 'all', action: 'reload', development: true },
  { keys: ['f12'], modifier: 'none', shift: false, platforms: 'all', action: 'toggle-devtools', development: true },
  // App actions (contracts/menu-and-shortcuts.md). `lock` works while locked; the others reach data.
  { keys: ['n'], modifier: 'primary', shift: false, platforms: 'all', action: 'new-transaction', data: true },
  { keys: ['l'], modifier: 'primary', shift: false, platforms: 'all', action: 'lock' },
  { keys: [','], modifier: 'primary', shift: false, platforms: 'all', action: 'settings', data: true },
  { keys: ['f'], modifier: 'primary', shift: false, platforms: 'all', action: 'search', data: true },
  { keys: ['k'], modifier: 'primary', shift: false, platforms: 'all', action: 'palette', data: true },
  { keys: ['m'], modifier: 'primary', shift: true, platforms: 'all', action: 'privacy', data: true },
  { keys: ['1'], modifier: 'primary', shift: false, platforms: 'all', action: 'go:overview', data: true },
  { keys: ['2'], modifier: 'primary', shift: false, platforms: 'all', action: 'go:transactions', data: true },
  { keys: ['3'], modifier: 'primary', shift: false, platforms: 'all', action: 'go:accounts', data: true },
  { keys: ['4'], modifier: 'primary', shift: false, platforms: 'all', action: 'go:plan', data: true },
  { keys: ['5'], modifier: 'primary', shift: false, platforms: 'all', action: 'go:settings', data: true },
  { keys: ['i'], modifier: 'primary', shift: true, platforms: 'all', action: 'import', data: true },
  { keys: ['e'], modifier: 'primary', shift: true, platforms: 'all', action: 'export', data: true },
];

/** The entry for a key press, or undefined for anything this table does not own. */
export function matchShortcut(input: ShortcutInput, platform: NodeJS.Platform, development = false, table: readonly ShortcutEntry[] = SHORTCUTS): ShortcutEntry | undefined {
  const mac = platform === 'darwin';
  const key = input.key.toLowerCase();
  return table.find((entry) => {
    if (entry.development === true && !development) return false;
    if (entry.platforms === 'mac' ? !mac : entry.platforms === 'other' ? mac : false) return false;
    if (!entry.keys.includes(key)) return false;
    if (entry.shift !== 'any' && entry.shift !== input.shift) return false;
    if (input.alt) return false;
    const wantControl = entry.modifier === 'both' || (entry.modifier === 'primary' && !mac);
    const wantMeta = entry.modifier === 'both' || (entry.modifier === 'primary' && mac);
    return input.control === wantControl && input.meta === wantMeta;
  });
}

export interface ShortcutDeps {
  readonly platform: NodeJS.Platform;
  readonly development: boolean;
  readonly pageLocked: () => boolean;
  readonly quit: () => void;
  /** Sends the page an app action (the `menu-action` event). */
  readonly sendAction: (action: AppShortcutAction) => void;
  /** The entries to use; the shell's own table unless a test passes another. */
  readonly table?: readonly ShortcutEntry[];
}

const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 3;

function perform(action: ShortcutAction | AppShortcutAction, contents: WebContents, win: BrowserWindow, deps: ShortcutDeps): void {
  switch (action) {
    case 'undo': return contents.undo();
    case 'redo': return contents.redo();
    case 'cut': return contents.cut();
    case 'copy': return contents.copy();
    case 'paste': return contents.paste();
    case 'select-all': return contents.selectAll();
    case 'zoom-in': return contents.setZoomLevel(Math.min(ZOOM_LIMIT, contents.getZoomLevel() + ZOOM_STEP));
    case 'zoom-out': return contents.setZoomLevel(Math.max(-ZOOM_LIMIT, contents.getZoomLevel() - ZOOM_STEP));
    case 'zoom-reset': return contents.setZoomLevel(0);
    case 'close': return win.close();
    case 'minimize': return win.minimize();
    case 'toggle-fullscreen': return win.setFullScreen(!win.isFullScreen());
    case 'quit': return deps.quit();
    case 'reload': return contents.reload();
    case 'toggle-devtools': return contents.toggleDevTools();
    default: return deps.sendAction(action);
  }
}

/** Runs the table on the window's key presses. A press that is handled is stopped from reaching the page. */
export function installShortcuts(contents: WebContents, win: BrowserWindow, deps: ShortcutDeps): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const entry = matchShortcut(input, deps.platform, deps.development, deps.table);
    if (entry === undefined) return;
    event.preventDefault();
    if (entry.data === true && deps.pageLocked()) return;
    perform(entry.action, contents, win, deps);
  });
}
