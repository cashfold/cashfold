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
    expect(Object.keys(api).sort()).toEqual(['about', 'revealDataFolder', 'setLanguage', 'updates']);
    expect(Object.keys(api['updates'] as object).sort()).toEqual(['autoCheck', 'check', 'download', 'install', 'onChange', 'openReleasePage', 'setAutoCheck', 'state']);
  });

  it('never hands the page the raw IPC object or a generic way to call any channel', () => {
    const { ipc } = fakeIpc();
    const exposeInMainWorld = vi.fn();
    installBridge({ exposeInMainWorld }, ipc);
    const api = exposeInMainWorld.mock.calls[0]![1] as Record<string, unknown>;
    const reachable = JSON.stringify(Object.keys(api)) + JSON.stringify(Object.keys(api['updates'] as object));
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
