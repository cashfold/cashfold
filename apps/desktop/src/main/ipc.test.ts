import { CHANNELS } from '@cashfold/platform';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './log';
import { registerIpc, type IpcMainLike, type IpcHandlers } from './ipc';

const about = {
  version: '1.2.3',
  buildId: 'abc',
  electron: '45.0.0',
  chromium: '140.0.0.0',
  os: 'linux',
  arch: 'x64',
  packaging: 'appimage',
  updateMode: 'manual',
  signed: false,
  dataPath: '/home/someone/.config/Cashfold',
  sourceUrl: 'https://github.com/cashfold/cashfold/tree/v1.2.3',
} as const;

type Listener = (event: { senderFrame?: { url: string } | null }, ...args: unknown[]) => unknown;

function setup(overrides: Partial<IpcHandlers> = {}) {
  const handlers = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener as Listener) };
  const log = { ipc: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } satisfies Logger;
  let autoCheck = true;
  const impl: IpcHandlers = {
    about: vi.fn(() => about),
    revealDataFolder: vi.fn(async () => undefined),
    updateState: vi.fn(() => ({ kind: 'idle' as const })),
    updateCheck: vi.fn(async () => ({ kind: 'none' as const })),
    updateDownload: vi.fn(async () => ({ kind: 'ready' as const, version: '1.3.0' })),
    updateInstall: vi.fn(async () => undefined),
    openReleasePage: vi.fn(async () => undefined),
    autoCheck: vi.fn((set?: boolean) => {
      if (set !== undefined) autoCheck = set;
      return autoCheck;
    }),
    ...overrides,
  };
  registerIpc({ ipcMain, log, handlers: impl });
  const call = (channel: string, event: Parameters<Listener>[0], ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return handler(event, ...args);
  };
  const fromApp = { senderFrame: { url: 'app://cashfold/overview/' } };
  return { impl, log, call, fromApp, handlers };
}

describe('registering the channels', () => {
  it('serves the channels of this build and no others', () => {
    const { handlers } = setup();
    const expected = Object.values(CHANNELS).filter((channel) => channel !== CHANNELS.updateChanged); // the last one is an event to the page, not a call
    expect([...handlers.keys()].sort()).toEqual([...expected].sort());
  });
});

describe('who may call', () => {
  it.each([
    ['another site', { senderFrame: { url: 'https://example.com/' } }],
    ['a look-alike host', { senderFrame: { url: 'app://cashfold.evil/' } }],
    ['another app origin', { senderFrame: { url: 'app://other/' } }],
    ['a file page', { senderFrame: { url: 'file:///tmp/x.html' } }],
    ['no frame at all', { senderFrame: null }],
    ['no frame property', {}],
    ['an unparsable address', { senderFrame: { url: 'not a url' } }],
  ])('refuses %s, and does nothing', async (_name, event) => {
    const { call, impl, log } = setup();
    await expect(Promise.resolve().then(() => call(CHANNELS.about, event))).rejects.toThrow('refused');
    expect(impl.about).not.toHaveBeenCalled();
    expect(log.ipc).toHaveBeenCalledWith(CHANNELS.about, 'rejected');
  });

  it('answers the app origin, with or without a path', async () => {
    const { call } = setup();
    for (const url of ['app://cashfold/', 'app://cashfold/overview/', 'app://cashfold/settings/advanced/?x=1#y']) {
      await expect(Promise.resolve(call(CHANNELS.about, { senderFrame: { url } }))).resolves.toEqual(about);
    }
  });
});

describe('what may be asked', () => {
  it('takes no argument for the channels that take none', async () => {
    const { call, fromApp, impl } = setup();
    for (const channel of [CHANNELS.about, CHANNELS.revealDataFolder, CHANNELS.updateState, CHANNELS.updateCheck, CHANNELS.updateDownload, CHANNELS.updateInstall, CHANNELS.updateReleasePage]) {
      await expect(Promise.resolve().then(() => call(channel, fromApp, '/etc/passwd'))).rejects.toThrow('refused');
    }
    expect(impl.about).not.toHaveBeenCalled();
    expect(impl.revealDataFolder).not.toHaveBeenCalled();
  });

  it('refuses every channel to a caller that is not the app, including the update ones', async () => {
    const { call, impl } = setup();
    const stranger = { senderFrame: { url: 'https://example.com/' } };
    for (const channel of [CHANNELS.updateCheck, CHANNELS.updateDownload, CHANNELS.updateInstall, CHANNELS.updateReleasePage, CHANNELS.updateAutoCheck, CHANNELS.revealDataFolder]) {
      await expect(Promise.resolve().then(() => call(channel, stranger)), channel).rejects.toThrow('refused');
    }
    expect(impl.updateDownload).not.toHaveBeenCalled();
    expect(impl.updateInstall).not.toHaveBeenCalled();
  });

  it('passes the update steps through and checks what they answer', async () => {
    const { call, fromApp, impl, log } = setup();
    await expect(Promise.resolve(call(CHANNELS.updateCheck, fromApp))).resolves.toEqual({ kind: 'none' });
    await expect(Promise.resolve(call(CHANNELS.updateDownload, fromApp))).resolves.toEqual({ kind: 'ready', version: '1.3.0' });
    await expect(Promise.resolve(call(CHANNELS.updateInstall, fromApp))).resolves.toBeUndefined();
    expect(impl.updateInstall).toHaveBeenCalledWith();
    const bad = setup({ updateCheck: vi.fn(async () => ({ kind: 'installing' }) as never) });
    await expect(Promise.resolve().then(() => bad.call(CHANNELS.updateCheck, bad.fromApp))).rejects.toThrow();
    expect(bad.log.ipc).toHaveBeenCalledWith(CHANNELS.updateCheck, 'error');
    expect(log.ipc).toHaveBeenCalledWith(CHANNELS.updateInstall, 'ok');
  });

  it('turns a refused step into a failure the page sees, without saying why', async () => {
    const { call, fromApp } = setup({ updateInstall: vi.fn(async () => { throw new Error('nothing is ready to install: /secret'); }) });
    const failure = await Promise.resolve(call(CHANNELS.updateInstall, fromApp)).catch((e: unknown) => e as Error);
    expect((failure as Error).message).toBe('failed');
  });

  it('opens the data folder without being told which one: the path comes from main only', async () => {
    const { call, fromApp, impl } = setup();
    await expect(Promise.resolve(call(CHANNELS.revealDataFolder, fromApp))).resolves.toBeUndefined();
    expect(impl.revealDataFolder).toHaveBeenCalledWith();
  });

  it('reads and sets the automatic update check, and nothing else', async () => {
    const { call, fromApp } = setup();
    await expect(Promise.resolve(call(CHANNELS.updateAutoCheck, fromApp, {}))).resolves.toBe(true);
    await expect(Promise.resolve(call(CHANNELS.updateAutoCheck, fromApp, { set: false }))).resolves.toBe(false);
    await expect(Promise.resolve(call(CHANNELS.updateAutoCheck, fromApp, {}))).resolves.toBe(false);
    for (const bad of [{ set: 'no' }, { set: 1 }, { extra: true }, { set: true, extra: true }, 'text', null, 5]) {
      await expect(Promise.resolve().then(() => call(CHANNELS.updateAutoCheck, fromApp, bad)), JSON.stringify(bad)).rejects.toThrow('refused');
    }
    await expect(Promise.resolve().then(() => call(CHANNELS.updateAutoCheck, fromApp, {}, {}))).rejects.toThrow('refused');
  });
});

describe('what is answered', () => {
  it('checks the answer against the contract before it leaves', async () => {
    const { call, fromApp, log } = setup({ about: vi.fn(() => ({ ...about, os: 'plan9' }) as never) });
    await expect(Promise.resolve().then(() => call(CHANNELS.about, fromApp))).rejects.toThrow();
    expect(log.ipc).toHaveBeenCalledWith(CHANNELS.about, 'error');
  });

  it('does not pass on the details of a failure', async () => {
    const { call, fromApp } = setup({ revealDataFolder: vi.fn(async () => Promise.reject(new Error('EACCES /secret/path'))) });
    const failure = await Promise.resolve(call(CHANNELS.revealDataFolder, fromApp)).catch((e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain('/secret/path');
  });

  it('logs the channel and the outcome of each call, never what was in it', async () => {
    const { call, fromApp, log } = setup();
    await call(CHANNELS.updateAutoCheck, fromApp, { set: false });
    expect(log.ipc).toHaveBeenCalledWith(CHANNELS.updateAutoCheck, 'ok');
    for (const [, ...rest] of log.ipc.mock.calls) expect(JSON.stringify(rest)).not.toContain('false');
  });
});
