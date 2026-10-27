import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, onUpdateEvent, registerServiceWorker, UPDATE_CHECK_INTERVAL_MS } from './register';
import type { UpdateEvent } from './update-state';

// The desktop app serves its files from the app itself, so it has nothing to cache and no second update mechanism to fight the updater (R-D-06).

function install(bridge: unknown) {
  const register = vi.fn(async () => ({ addEventListener: vi.fn(), waiting: null, installing: null }));
  vi.stubGlobal('navigator', { serviceWorker: { register, controller: null } });
  if (bridge !== undefined) vi.stubGlobal('cashfoldDesktop', bridge);
  vi.stubEnv('NODE_ENV', 'production');
  return register;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('registering the offline worker', () => {
  it('registers in the web app, as before', async () => {
    const register = install(undefined);
    await registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });

  it('does not register in the desktop app', async () => {
    const noop = () => undefined;
    const bridge = { about: noop, revealDataFolder: noop, updates: { state: noop, check: noop, download: noop, install: noop, openReleasePage: noop, autoCheck: noop, setAutoCheck: noop, onChange: noop } };
    const register = install(bridge);
    await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it('still registers when something that is not the bridge sits under its name', async () => {
    const register = install({});
    await registerServiceWorker();
    expect(register).toHaveBeenCalledTimes(1);
  });
});

// Spec 009: the page learns of a waiting version, checks for one on its own, and every window leaves the old version after a switch.

type Handler = () => void;
function world(opts: { controller?: boolean; waiting?: boolean } = {}) {
  const registrationHandlers = new Map<string, Handler>();
  const workerHandlers = new Map<string, Handler>();
  const container = new Map<string, Handler>();
  const update = vi.fn(async () => undefined);
  const postMessage = vi.fn();
  const registration = {
    addEventListener: (type: string, handler: Handler) => void registrationHandlers.set(type, handler),
    waiting: opts.waiting === true ? { postMessage } : null,
    installing: null as null | { state: string; addEventListener: (t: string, h: Handler) => void },
    update,
  };
  const controller = opts.controller === false ? null : {};
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => registration), controller, addEventListener: (type: string, h: Handler) => void container.set(type, h) } });
  const doc = new Map<string, Handler>();
  const win = new Map<string, Handler>();
  const reload = vi.fn();
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: (t: string, h: Handler) => void doc.set(t, h) });
  vi.stubGlobal('window', { addEventListener: (t: string, h: Handler) => void win.set(t, h), dispatchEvent: vi.fn(), location: { reload } });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: 'v2' }) })));
  vi.stubEnv('NODE_ENV', 'production');
  const updatefound = (state = 'installing') => {
    const worker = { state, addEventListener: (t: string, h: Handler) => void workerHandlers.set(t, h) };
    registration.installing = worker;
    registrationHandlers.get('updatefound')?.();
    return worker;
  };
  return { registration, container, doc, win, workerHandlers, update, postMessage, reload, updatefound };
}
const collect = () => { const seen: UpdateEvent[] = []; return { seen, stop: onUpdateEvent((e) => seen.push(e)) }; };

describe('learning of a new version', () => {
  it('announces a version that is already waiting when the page opens', async () => {
    world({ waiting: true });
    const { seen, stop } = collect();
    await registerServiceWorker();
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'waiting-found', version: 'v2' }]));
    stop();
  });

  it('announces a version that finishes installing while the page is open, and a failed install', async () => {
    const w = world();
    const { seen, stop } = collect();
    await registerServiceWorker();
    const worker = w.updatefound();
    worker.state = 'installed';
    w.workerHandlers.get('statechange')?.();
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'waiting-found', version: 'v2' }]));
    const next = w.updatefound();
    next.state = 'redundant';
    w.workerHandlers.get('statechange')?.();
    expect(seen.at(-1)).toEqual({ type: 'install-failed' });
    stop();
  });
});

describe('checking for a new version', () => {
  it('asks when the window is shown again, when the connection returns, and every hour; and ignores a failed check', async () => {
    vi.useFakeTimers();
    const w = world();
    w.update.mockRejectedValueOnce(new Error('offline'));
    await registerServiceWorker();
    w.doc.get('visibilitychange')?.();
    expect(w.update).toHaveBeenCalledTimes(1);
    w.win.get('online')?.();
    expect(w.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(w.update).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not ask while the window is hidden', async () => {
    const w = world();
    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: (t: string, h: Handler) => void w.doc.set(t, h) });
    await registerServiceWorker();
    w.doc.get('visibilitychange')?.();
    expect(w.update).not.toHaveBeenCalled();
  });
});

describe('switching to a new version', () => {
  it('asks the waiting worker to take over, and reloads once when it does, for the window that asked', async () => {
    const w = world({ waiting: true });
    const { seen, stop } = collect();
    await registerServiceWorker();
    applyUpdate();
    expect(w.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    w.container.get('controllerchange')?.();
    expect(w.reload).toHaveBeenCalledTimes(1);
    expect(seen).toContainEqual({ type: 'controller-changed', own: true });
    stop();
  });

  it('tells a window that did not ask that another one switched, and does not reload it itself', async () => {
    const w = world();
    const { seen, stop } = collect();
    await registerServiceWorker();
    w.container.get('controllerchange')?.();
    expect(seen).toEqual([{ type: 'controller-changed', own: false }]);
    expect(w.reload).not.toHaveBeenCalled();
    stop();
  });

  it('does nothing when the worker first takes control of a page that had none', async () => {
    const w = world({ controller: false });
    const { seen, stop } = collect();
    await registerServiceWorker();
    w.container.get('controllerchange')?.();
    expect(seen).toEqual([]);
    expect(w.reload).not.toHaveBeenCalled();
    w.container.get('controllerchange')?.();
    expect(seen).toEqual([{ type: 'controller-changed', own: false }]);
    stop();
  });
});

