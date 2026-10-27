import { describe, expect, it, vi } from 'vitest';
import { labelsFor } from './menu-labels';
import { createPresence, dockEntries, jumpListCategories, parseLaunchAction, recentEntries, trayEntries, type TrayLike } from './tray';

const labels = labelsFor('en');
const FOLDS = [
  { id: 'f1', name: 'Household' },
  { id: 'f2', name: 'Trip to Lisbon' },
];

describe('the tray or menu-bar menu', () => {
  it('is Show, Add transaction, Lock, then Quit, and names no Fold', () => {
    const entries = trayEntries(labels);
    expect(entries.map((e) => ('separator' in e ? '-' : e.action))).toEqual(['show', 'add-transaction', 'lock', '-', 'quit']);
    expect(JSON.stringify(entries)).not.toMatch(/Household|Lisbon/);
  });
});

describe('the dock menu and the jump list', () => {
  it('offer the two tasks and, with Folds, a group of at most five recent ones', () => {
    expect(dockEntries(labels, []).map((e) => ('separator' in e ? '-' : e.action))).toEqual(['add-transaction', 'lock']);
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `Fold ${i}` }));
    expect(dockEntries(labels, many).map((e) => ('separator' in e ? '-' : e.label))).toEqual(['Add transaction', 'Lock', '-', 'Fold 0', 'Fold 1', 'Fold 2', 'Fold 3', 'Fold 4']);
    expect(jumpListCategories(labels, many, 'C:\\Cashfold.exe').map((c) => c.type)).toEqual(['tasks', 'custom']);
  });

  it('carry launch arguments from the closed set only', () => {
    const [tasks, recent] = jumpListCategories(labels, FOLDS, 'cashfold.exe');
    expect(tasks!.items.map((i) => i.args)).toEqual(['--action=add-transaction', '--action=lock']);
    expect(recent!.items.map((i) => i.args)).toEqual(['--action=open-fold:0', '--action=open-fold:1']);
    for (const item of [...tasks!.items, ...recent!.items]) expect(parseLaunchAction([item.args])).toBeDefined();
  });

  it('shorten a long Fold name', () => {
    const [entry] = recentEntries([{ id: 'x', name: 'x'.repeat(80) }]);
    expect(entry && 'label' in entry && entry.label.length).toBe(40);
  });
});

describe('the launch argument', () => {
  it.each([
    [['--action=add-transaction'], 'add-transaction'],
    [['app', '--action=lock'], 'lock'],
    [['--action=open-fold:3'], 'open-fold:3'],
  ])('%j is %s', (argv, expected) => expect(parseLaunchAction(argv)).toBe(expected));

  it.each([[[]], [['--action=quit']], [['--action=show']], [['--action=open-fold:5']], [['--action=open-fold:-1']], [['--action=add-transaction;rm']], [['--action=']], [['--other=lock']]])(
    '%j is ignored',
    (argv) => expect(parseLaunchAction(argv)).toBeUndefined(),
  );
});

function setup(options: { platform?: NodeJS.Platform; unlocked?: boolean; statusItem?: boolean } = {}) {
  const templates: Array<Array<{ label?: string; type?: string; click?: () => void }>> = [];
  const tray: TrayLike = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
  const state = { unlocked: options.unlocked ?? true };
  const perform = vi.fn();
  const setDockMenu = vi.fn();
  const setJumpList = vi.fn();
  const presence = createPresence({
    platform: options.platform ?? 'darwin',
    statusItem: options.statusItem ?? true,
    labels: () => labels,
    unlocked: () => state.unlocked,
    menu: { buildFromTemplate: (template: unknown) => (templates.push(template as never), { template } as never) },
    createTray: () => tray,
    setDockMenu,
    setJumpList,
    program: 'cashfold',
    appName: 'Cashfold',
    perform,
  });
  const dockLabels = () => (setDockMenu.mock.lastCall?.[0] as { template: Array<{ label?: string }> } | undefined)?.template.map((i) => i.label);
  const jumpNames = () => JSON.stringify(setJumpList.mock.lastCall?.[0] ?? []);
  return { presence, state, tray, perform, setDockMenu, setJumpList, templates, dockLabels, jumpNames };
}

describe('presence', () => {
  it('reports what each surface shows, with no Fold name once cleared', () => {
    const { presence } = setup({ platform: 'win32' });
    presence.start();
    presence.setRecentFolds(FOLDS);
    expect(presence.models().jumpList).toEqual(['Add transaction', 'Lock', 'Household', 'Trip to Lisbon']);
    expect(presence.models().tray).toEqual(['Show Cashfold', 'Add transaction', 'Lock', 'Quit']);
    presence.clearRecent();
    expect(JSON.stringify(presence.models())).not.toMatch(/Household|Lisbon/);
  });

  it('shows the tray with a tooltip, and a click brings the window back off macOS', () => {
    const { presence, tray, perform } = setup({ platform: 'win32' });
    presence.start();
    expect(tray.setToolTip).toHaveBeenCalledWith('Cashfold');
    (vi.mocked(tray.on).mock.calls[0]![1] as () => void)();
    expect(perform).toHaveBeenCalledWith('show');
  });

  it('shows no tray where the desktop has no status icons', () => {
    const { presence, tray } = setup({ platform: 'linux', statusItem: false });
    presence.start();
    expect(tray.setToolTip).not.toHaveBeenCalled();
  });

  it('puts recent Fold names in the dock menu and the jump list while unlocked, and runs the chosen action', () => {
    const mac = setup({ platform: 'darwin' });
    mac.presence.start();
    mac.presence.setRecentFolds(FOLDS);
    expect(mac.dockLabels()).toEqual(['Add transaction', 'Lock', undefined, 'Household', 'Trip to Lisbon']);
    const dock = mac.setDockMenu.mock.lastCall![0] as unknown as { template: Array<{ click?: () => void }> };
    dock.template[3]!.click!();
    expect(mac.perform).toHaveBeenCalledWith('open-fold:0');
    const win = setup({ platform: 'win32' });
    win.presence.start();
    win.presence.setRecentFolds(FOLDS);
    expect(win.jumpNames()).toContain('Household');
  });

  it('takes no Fold name while locked, and forgets them when cleared (a lock, a system lock)', () => {
    const { presence, state, dockLabels, jumpNames, setDockMenu } = setup({ platform: 'darwin' });
    presence.start();
    state.unlocked = false;
    presence.setRecentFolds(FOLDS);
    expect(JSON.stringify(setDockMenu.mock.lastCall)).not.toMatch(/Household/);
    state.unlocked = true;
    presence.setRecentFolds(FOLDS);
    expect(dockLabels()).toContain('Household');
    presence.clearRecent();
    expect(dockLabels()).toEqual(['Add transaction', 'Lock']);
    expect(jumpNames()).not.toMatch(/Household/);
  });

  it('starts with tasks only, so a list the operating system kept after a crash is replaced', () => {
    const { presence, setJumpList } = setup({ platform: 'win32' });
    presence.start();
    const categories = setJumpList.mock.lastCall![0] as Array<{ type: string }>;
    expect(categories.map((c) => c.type)).toEqual(['tasks']);
  });

  it('removes the Fold names and the tray at quit', () => {
    const { presence, tray, dockLabels } = setup({ platform: 'darwin' });
    presence.start();
    presence.setRecentFolds(FOLDS);
    presence.dispose();
    expect(dockLabels()).toEqual(['Add transaction', 'Lock']);
    expect(tray.destroy).toHaveBeenCalled();
  });

  it('keeps the Fold names out of the tray menu entirely', () => {
    const { presence, templates } = setup({ platform: 'win32' });
    presence.start();
    presence.setRecentFolds(FOLDS);
    expect(JSON.stringify(templates.filter((t) => t.some((i) => i.label === 'Show Cashfold')).map((t) => t.map((i) => i.label)))).not.toMatch(/Household/);
  });
});
