import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '@cashfold/platform';
import { createBridge, installBridge, type IpcRendererLike } from './bridge';

const about = {
  version: '1.2.3',
  buildId: 'abc',
  electron: '45.0.0',
  chromium: '140.0.0.0',
  os: 'darwin',
  arch: 'arm64',
  packaging: 'dmg',
  updateMode: 'manual',
  signed: false,
  dataPath: '/Users/someone/Library/Application Support/Cashfold',
  sourceUrl: 'https://github.com/cashfold/cashfold/tree/v1.2.3',
};

function fakeIpc(answers: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>();
  const ipc = {
    invoke: vi.fn(async (channel: string) => answers[channel]),
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    }),
    removeListener: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, (listeners.get(channel) ?? []).filter((l) => l !== listener));
    }),
  } satisfies IpcRendererLike;
  return { ipc, emit: (channel: string, ...args: unknown[]) => (listeners.get(channel) ?? []).forEach((l) => l({}, ...args)) };
}

describe('what the page can reach', () => {
  it('exposes exactly one frozen global, and nothing else', () => {
    const { ipc } = fakeIpc();
    const exposeInMainWorld = vi.fn();
    installBridge({ exposeInMainWorld }, ipc);
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [name, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('cashfoldDesktop');
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api['updates'])).toBe(true);
    expect(Object.isFrozen(api['settings'])).toBe(true);
    expect(Object.keys(api).sort()).toEqual([
      'about',
      'onFrameState',
      'onIncoming',
      'onMenuAction',
      'onSettingsChanged',
      'onSystemLock',
      'platform',
      'popupMenu',
      'reportSession',
      'revealDataFolder',
      'setBadge',
      'setLanguage',
      'setRecentFolds',
      'setTheme',
      'settings',
      'showWindow',
      'updates',
    ]);
    expect(Object.keys(api['settings'] as object).sort()).toEqual(['get', 'set']);
    expect(Object.keys(api['updates'] as object).sort()).toEqual(['autoCheck', 'check', 'download', 'install', 'onChange', 'openReleasePage', 'setAutoCheck', 'state']);
  });

  it('never hands the page the raw IPC object or a generic way to call any channel', () => {
    const { ipc } = fakeIpc();
    const exposeInMainWorld = vi.fn();
    installBridge({ exposeInMainWorld }, ipc);
    const api = exposeInMainWorld.mock.calls[0]![1] as Record<string, unknown>;
    const reachable = JSON.stringify(Object.keys(api)) + JSON.stringify(Object.keys(api['updates'] as object)) + JSON.stringify(Object.keys(api['settings'] as object));
    for (const forbidden of ['invoke', 'send', 'sendSync', 'ipcRenderer', 'removeListener', 'on']) expect(reachable).not.toContain(`"${forbidden}"`);
    for (const value of [...Object.values(api), ...Object.values(api['updates'] as object)]) expect(value).not.toBe(ipc);
  });
});

describe('calls', () => {
  it('asks the fixed channel and returns the checked answer', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.about]: about });
    await expect(createBridge(ipc).about()).resolves.toEqual(about);
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.about);
  });

  it('refuses an answer that does not match the contract, including an extra key', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.about]: { ...about, extra: 1 }, [CHANNELS.updateState]: { kind: 'installing' } });
    const bridge = createBridge(ipc);
    await expect(bridge.about()).rejects.toThrow();
    await expect(bridge.updates.state()).rejects.toThrow();
  });

  it('sends the language only as one of the languages the shell knows', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.setLanguage]: undefined });
    const bridge = createBridge(ipc);
    await bridge.setLanguage('pl');
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.setLanguage, { language: 'pl' });
    await expect(bridge.setLanguage('ar' as never)).rejects.toThrow();
    await expect(bridge.setLanguage('/etc/passwd' as never)).rejects.toThrow();
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
  });

  it('sends nothing else the page chose, except the auto-check switch', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.updateAutoCheck]: true, [CHANNELS.updateState]: { kind: 'idle' }, [CHANNELS.revealDataFolder]: undefined });
    const bridge = createBridge(ipc);
    await bridge.revealDataFolder();
    await bridge.updates.state();
    expect(ipc.invoke).toHaveBeenNthCalledWith(1, CHANNELS.revealDataFolder);
    expect(ipc.invoke).toHaveBeenNthCalledWith(2, CHANNELS.updateState);
    await bridge.updates.autoCheck();
    await bridge.updates.setAutoCheck(false);
    expect(ipc.invoke).toHaveBeenNthCalledWith(3, CHANNELS.updateAutoCheck, {});
    expect(ipc.invoke).toHaveBeenNthCalledWith(4, CHANNELS.updateAutoCheck, { set: false });
  });

  it('rejects a void call that answers with something', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.updateInstall]: 'surprise' });
    await expect(createBridge(ipc).updates.install()).rejects.toThrow();
  });
});

describe('desktop experience calls', () => {
  it('exposes the platform it was started on, and refuses one the app is not built for', () => {
    expect(createBridge(fakeIpc().ipc, 'darwin').platform).toBe('darwin');
    expect(() => createBridge(fakeIpc().ipc, 'freebsd')).toThrow();
  });

  it('reads settings and sends only checked changes', async () => {
    const settings = { hideOnBlur: false, startAtLogin: false, closeBehavior: 'quit', theme: 'system' };
    const capabilities = { platform: 'linux', lockEvents: ['suspend'], badge: false, statusItem: false, jumpList: false, dockMenu: false, notifications: 'granted', translucency: 'unavailable', loginItem: true };
    const { ipc } = fakeIpc({ [CHANNELS.settings]: { settings, capabilities }, [CHANNELS.settingsSet]: { settings, applied: { startAtLogin: true } } });
    const bridge = createBridge(ipc);
    await expect(bridge.settings.get()).resolves.toEqual({ settings, capabilities });
    await bridge.settings.set({ hideOnBlur: true });
    expect(ipc.invoke).toHaveBeenLastCalledWith(CHANNELS.settingsSet, { hideOnBlur: true });
    await expect(bridge.settings.set({})).rejects.toThrow();
    await expect(bridge.settings.set({ theme: 'dark' } as never)).rejects.toThrow();
    expect(ipc.invoke).toHaveBeenCalledTimes(2);
  });

  it('refuses a settings answer with an extra key', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.settings]: { settings: {}, capabilities: {} } });
    await expect(createBridge(ipc).settings.get()).rejects.toThrow();
  });

  it('sends theme, session, badge, recent Folds and menu items only when they fit their schema', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.popupMenu]: { id: 'edit' } });
    const bridge = createBridge(ipc);
    await bridge.setTheme('dark');
    expect(ipc.invoke).toHaveBeenLastCalledWith(CHANNELS.theme, { theme: 'dark' });
    await bridge.reportSession('locked');
    expect(ipc.invoke).toHaveBeenLastCalledWith(CHANNELS.session, { state: 'locked' });
    await bridge.setBadge(7);
    expect(ipc.invoke).toHaveBeenLastCalledWith(CHANNELS.badge, { count: 7 });
    await bridge.setRecentFolds([{ id: 'a', name: 'Home' }]);
    expect(ipc.invoke).toHaveBeenLastCalledWith(CHANNELS.recentFolds, { folds: [{ id: 'a', name: 'Home' }] });
    await expect(bridge.popupMenu([{ id: 'edit', label: 'Edit' }])).resolves.toBe('edit');
    const calls = vi.mocked(ipc.invoke).mock.calls.length;
    await expect(bridge.setTheme('sepia' as never)).rejects.toThrow();
    await expect(bridge.setBadge(1000)).rejects.toThrow();
    await expect(bridge.setRecentFolds(Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, name: 'x' })))).rejects.toThrow();
    await expect(bridge.popupMenu([{ id: 'Edit', label: 'Edit' }])).rejects.toThrow();
    expect(ipc.invoke).toHaveBeenCalledTimes(calls);
  });

  it('shows the window with no argument', async () => {
    const { ipc } = fakeIpc({ [CHANNELS.windowShow]: undefined });
    await createBridge(ipc).showWindow();
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.windowShow);
  });
});

describe('desktop experience events', () => {
  it('passes valid events and drops invalid ones, for each event channel', () => {
    const { ipc, emit } = fakeIpc();
    const bridge = createBridge(ipc);
    const lock = vi.fn();
    const action = vi.fn();
    const frame = vi.fn();
    const incoming = vi.fn();
    const changed = vi.fn();
    bridge.onSystemLock(lock);
    bridge.onMenuAction(action);
    bridge.onFrameState(frame);
    bridge.onIncoming(incoming);
    bridge.onSettingsChanged(changed);
    emit(CHANNELS.systemLock, { reason: 'suspend' });
    emit(CHANNELS.systemLock, { reason: 'because' });
    emit(CHANNELS.menuAction, { action: 'new-transaction' });
    emit(CHANNELS.menuAction, { action: 'format-disk' });
    emit(CHANNELS.frameState, { fullscreen: true, maximized: false, translucent: false });
    emit(CHANNELS.frameState, { fullscreen: true });
    emit(CHANNELS.incoming, { kind: 'link', name: 'l', link: { screen: 'open', target: 'plan' } });
    emit(CHANNELS.incoming, { kind: 'csv', name: 'a.csv', bytes: 'not bytes' });
    emit(CHANNELS.settingsChanged, { hideOnBlur: true, startAtLogin: false, closeBehavior: 'quit', theme: 'dark' });
    emit(CHANNELS.settingsChanged, { hideOnBlur: 'yes' });
    expect(lock).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledWith({ reason: 'suspend' });
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith('new-transaction');
    expect(frame).toHaveBeenCalledOnce();
    expect(incoming).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
  });

  it('stops listening when unsubscribed', () => {
    const { ipc, emit } = fakeIpc();
    const listener = vi.fn();
    createBridge(ipc).onSystemLock(listener)();
    emit(CHANNELS.systemLock, { reason: 'suspend' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('update events', () => {
  it('passes valid states to the listener and ignores invalid ones', () => {
    const { ipc, emit } = fakeIpc();
    const listener = vi.fn();
    createBridge(ipc).updates.onChange(listener);
    emit(CHANNELS.updateChanged, { kind: 'checking' });
    emit(CHANNELS.updateChanged, { kind: 'bogus' });
    emit(CHANNELS.updateChanged, 'not an object');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: 'checking' });
  });

  it('stops listening when unsubscribed', () => {
    const { ipc, emit } = fakeIpc();
    const listener = vi.fn();
    const unsubscribe = createBridge(ipc).updates.onChange(listener);
    unsubscribe();
    emit(CHANNELS.updateChanged, { kind: 'checking' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('items from outside', () => {
  it('tells the shell the page has a listener only when one is registered, and hands the page only items that match the schema', () => {
    const { ipc, emit } = fakeIpc({ [CHANNELS.incomingReady]: undefined });
    const bridge = createBridge(ipc);
    expect(ipc.invoke).not.toHaveBeenCalledWith(CHANNELS.incomingReady);
    const listener = vi.fn();
    const stop = bridge.onIncoming(listener);
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.incomingReady);
    emit(CHANNELS.incoming, { kind: 'refused', reason: 'secret' });
    emit(CHANNELS.incoming, { kind: 'delete-everything' });
    expect(listener.mock.calls).toEqual([[{ kind: 'refused', reason: 'secret' }]]);
    stop();
    emit(CHANNELS.incoming, { kind: 'refused', reason: 'secret' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is not troubled when the shell does not answer the ready signal', () => {
    const { ipc } = fakeIpc();
    ipc.invoke.mockRejectedValue(new Error('refused'));
    expect(() => createBridge(ipc).onIncoming(() => undefined)).not.toThrow();
  });
});

