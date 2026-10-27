import type { Menu, MenuItemConstructorOptions } from 'electron';
import type { ShellLabels } from './menu-labels';

// Presence outside the window: a tray (Windows, Linux) or menu-bar (macOS) item, the macOS dock menu and the Windows jump list. All three offer the
// same few actions; none shows a balance, an amount or an account name. Fold names are shown only in the "recent Folds" group, only while the app is
// unlocked, and are cleared on a lock, a system lock and quit. The operating system keeps the jump list after the app ends, so it is reset to its
// tasks at every start and at quit (spec 006, FR-019 and FR-020).

export const MAX_RECENT_FOLDS = 5;
const NAME_LIMIT = 40;

export type QuickAction = 'show' | 'add-transaction' | 'lock' | 'quit' | 'open-fold:0' | 'open-fold:1' | 'open-fold:2' | 'open-fold:3' | 'open-fold:4';
const LAUNCH_ACTIONS: ReadonlySet<string> = new Set<QuickAction>(['add-transaction', 'lock', 'open-fold:0', 'open-fold:1', 'open-fold:2', 'open-fold:3', 'open-fold:4']);

/** The `--action=` argument of a launch (a jump-list entry, a second start): only the closed set is accepted, anything else is ignored. */
export function parseLaunchAction(argv: readonly string[]): QuickAction | undefined {
  for (const arg of argv) {
    if (!arg.startsWith('--action=')) continue;
    const value = arg.slice('--action='.length);
    return LAUNCH_ACTIONS.has(value) ? (value as QuickAction) : undefined;
  }
  return undefined;
}

export interface RecentFold {
  readonly id: string;
  readonly name: string;
}

export type MenuEntry = { readonly action: QuickAction; readonly label: string } | { readonly separator: true };

/** The tray or menu-bar menu: the same in every state. */
export function trayEntries(labels: ShellLabels): MenuEntry[] {
  return [
    { action: 'show', label: labels.trayShow },
    { action: 'add-transaction', label: labels.trayAddTransaction },
    { action: 'lock', label: labels.trayLock },
    { separator: true },
    { action: 'quit', label: labels.trayQuit },
  ];
}

const truncate = (name: string): string => (name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name);

/** The recent-Folds entries, up to five, in the order the page sent them. */
export function recentEntries(folds: readonly RecentFold[]): MenuEntry[] {
  return folds.slice(0, MAX_RECENT_FOLDS).map((fold, index) => ({ action: `open-fold:${index}` as QuickAction, label: truncate(fold.name) }));
}

/** The macOS dock menu: the tasks, then the recent Folds when there are any. */
export function dockEntries(labels: ShellLabels, folds: readonly RecentFold[]): MenuEntry[] {
  const recent = recentEntries(folds);
  return [{ action: 'add-transaction', label: labels.trayAddTransaction }, { action: 'lock', label: labels.trayLock }, ...(recent.length > 0 ? [{ separator: true } as const, ...recent] : [])];
}

export interface JumpListItemLike {
  readonly type: 'task';
  readonly title: string;
  readonly program: string;
  readonly args: string;
  readonly iconPath: string;
  readonly iconIndex: number;
  readonly description: string;
}
export type JumpListCategoryLike = { readonly type: 'tasks'; readonly items: JumpListItemLike[] } | { readonly type: 'custom'; readonly name: string; readonly items: JumpListItemLike[] };

/** The Windows jump list: the tasks, then a "recent Folds" group when there are any. */
export function jumpListCategories(labels: ShellLabels, folds: readonly RecentFold[], program: string): JumpListCategoryLike[] {
  const task = (title: string, action: string): JumpListItemLike => ({ type: 'task', title, program, args: `--action=${action}`, iconPath: program, iconIndex: 0, description: title });
  const recent = recentEntries(folds).flatMap((entry) => ('action' in entry ? [task(entry.label, entry.action)] : []));
  return [
    { type: 'tasks', items: [task(labels.trayAddTransaction, 'add-transaction'), task(labels.trayLock, 'lock')] },
    ...(recent.length > 0 ? [{ type: 'custom', name: labels.recentFolds, items: recent } as const] : []),
  ];
}

export interface TrayLike {
  setToolTip(tip: string): void;
  setContextMenu(menu: Menu | null): void;
  on(event: 'click', listener: () => void): unknown;
  destroy(): void;
}

export interface PresenceDeps {
  readonly platform: NodeJS.Platform;
  /** Whether a tray or menu-bar item can be shown here. */
  readonly statusItem: boolean;
  readonly labels: () => ShellLabels;
  /** Whether the page last said it is unlocked. Fold names are only taken while it is. */
  readonly unlocked: () => boolean;
  readonly menu: Pick<typeof Menu, 'buildFromTemplate'>;
  readonly createTray: () => TrayLike;
  /** `app.dock.setMenu` (macOS). */
  readonly setDockMenu?: (menu: Menu) => void;
  /** `app.setJumpList` (Windows). */
  readonly setJumpList?: (categories: JumpListCategoryLike[]) => void;
  readonly program: string;
  readonly appName: string;
  /** Does what a quick action asks. */
  readonly perform: (action: QuickAction) => void;
}

export interface Presence {
  start(): void;
  setRecentFolds(folds: readonly RecentFold[]): void;
  /** Forgets the Fold names and redraws the menus with the tasks only. */
  clearRecent(): void;
  /** Redraws everything (the language changed). */
  refresh(): void;
  /** What each surface shows, as labels (for the packaged tests): nothing secret is in them when locked. */
  models(): { tray: string[]; dock: string[]; jumpList: string[] };
  dispose(): void;
}

export function createPresence(deps: PresenceDeps): Presence {
  let recent: readonly RecentFold[] = [];
  let tray: TrayLike | undefined;

  const template = (entries: MenuEntry[]): MenuItemConstructorOptions[] =>
    entries.map((entry) => ('separator' in entry ? { type: 'separator' as const } : { label: entry.label, click: () => deps.perform(entry.action) }));
  const draw = (): void => {
    const labels = deps.labels();
    tray?.setContextMenu(deps.menu.buildFromTemplate(template(trayEntries(labels))));
    if (deps.platform === 'darwin') deps.setDockMenu?.(deps.menu.buildFromTemplate(template(dockEntries(labels, recent))));
    if (deps.platform === 'win32') deps.setJumpList?.(jumpListCategories(labels, recent, deps.program));
  };

  return {
    start() {
      if (deps.statusItem && tray === undefined) {
        tray = deps.createTray();
        tray.setToolTip(deps.appName);
        // A click on the icon brings the window back (on macOS the click opens the menu, which has "Show").
        if (deps.platform !== 'darwin') tray.on('click', () => deps.perform('show'));
      }
      recent = [];
      draw();
    },
    setRecentFolds(folds) {
      recent = deps.unlocked() ? folds.slice(0, MAX_RECENT_FOLDS) : [];
      draw();
    },
    clearRecent() {
      recent = [];
      draw();
    },
    refresh: draw,
    models() {
      const labels = deps.labels();
      const names = (entries: MenuEntry[]): string[] => entries.flatMap((entry) => ('label' in entry ? [entry.label] : []));
      return {
        tray: names(trayEntries(labels)),
        dock: names(dockEntries(labels, recent)),
        jumpList: jumpListCategories(labels, recent, deps.program).flatMap((category) => category.items.map((item) => item.title)),
      };
    },
    dispose() {
      recent = [];
      draw();
      tray?.destroy();
      tray = undefined;
    },
  };
}
