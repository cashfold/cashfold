import type { ActionId } from './schemas';

// What the Help dialog lists (spec 008): the keyboard shortcuts of the desktop app, in plain data. The web page writes them the way the person's system
// does; the desktop package tests this list against the shell's own shortcut table in both directions, so the two cannot drift apart. It is data only:
// the shell's table (apps/desktop/src/main/shortcuts.ts) stays the one place that handles key presses.

/** The standard shortcuts, named as the shell names them. */
export type StandardAction =
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
  | 'quit';

/** `primary` is Command on macOS and Control elsewhere. */
export type HelpModifier = 'ctrl' | 'alt' | 'shift' | 'primary';

export interface HelpKeys {
  readonly modifiers: readonly HelpModifier[];
  /** The key as written, such as `N`, `,`, `+` or `F11`. */
  readonly key: string;
}

export type HelpSystem = 'mac' | 'other';
/** Who handles the press: the desktop shell's table, or the system (the macOS app menu, the editing keys of a text field elsewhere). */
export type HelpHandler = 'shell' | 'system';

export interface HelpShortcut {
  /** Also the end of the message key of its plain name: `help.shortcut.<id>`. */
  readonly id: string;
  /** `app` is the app's own; `standard` is the "also works" group. */
  readonly group: 'app' | 'standard';
  readonly action: ActionId | StandardAction;
  readonly keys: Readonly<Record<HelpSystem, HelpKeys>>;
  readonly via: Readonly<Record<HelpSystem, HelpHandler>>;
  /** Only Lock works while the app is locked. */
  readonly worksWhenLocked: boolean;
}

const primary = (key: string, ...more: HelpModifier[]): HelpKeys => ({ modifiers: ['primary', ...more], key });
const same = (keys: HelpKeys): Readonly<Record<HelpSystem, HelpKeys>> => ({ mac: keys, other: keys });
const shell = { mac: 'shell', other: 'shell' } as const;
const app = (id: string, action: ActionId, keys: HelpKeys): HelpShortcut => ({ id, group: 'app', action, keys: same(keys), via: shell, worksWhenLocked: action === 'lock' });
const standard = (id: string, action: StandardAction, keys: HelpKeys, via: Readonly<Record<HelpSystem, HelpHandler>> = shell): HelpShortcut => ({
  id, group: 'standard', action, keys: same(keys), via, worksWhenLocked: false,
});
/** Undo and the clipboard are done by the shell on macOS, where nothing else would, and by the text field itself elsewhere. */
const editing = { mac: 'shell', other: 'system' } as const;

export const HELP_SHORTCUTS: readonly HelpShortcut[] = [
  app('new-transaction', 'new-transaction', primary('N')),
  app('lock', 'lock', primary('L')),
  app('settings', 'settings', primary(',')),
  app('search', 'search', primary('F')),
  app('palette', 'palette', primary('K')),
  app('go-overview', 'go:overview', primary('1')),
  app('go-transactions', 'go:transactions', primary('2')),
  app('go-accounts', 'go:accounts', primary('3')),
  app('go-plan', 'go:plan', primary('4')),
  app('go-settings', 'go:settings', primary('5')),
  app('import', 'import', primary('I', 'shift')),
  app('export', 'export', primary('E', 'shift')),
  standard('undo', 'undo', primary('Z'), editing),
  standard('redo', 'redo', primary('Z', 'shift'), editing),
  standard('cut', 'cut', primary('X'), editing),
  standard('copy', 'copy', primary('C'), editing),
  standard('paste', 'paste', primary('V'), editing),
  standard('select-all', 'select-all', primary('A'), editing),
  standard('zoom-in', 'zoom-in', primary('+')),
  standard('zoom-out', 'zoom-out', primary('-')),
  standard('zoom-reset', 'zoom-reset', primary('0')),
  standard('close', 'close', primary('W')),
  standard('minimize', 'minimize', primary('M')),
  {
    id: 'fullscreen',
    group: 'standard',
    action: 'toggle-fullscreen',
    keys: { mac: { modifiers: ['ctrl', 'primary'], key: 'F' }, other: { modifiers: [], key: 'F11' } },
    via: shell,
    worksWhenLocked: false,
  },
  // On macOS Command+Q belongs to the application menu.
  { ...standard('quit', 'quit', primary('Q')), via: { mac: 'system', other: 'shell' } },
];
