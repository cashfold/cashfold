import type { DesktopBridge, DesktopSettings } from '@cashfold/platform';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesktopSettingsProvider, useDesktop } from './DesktopSettingsProvider';
import { createDesktopStore, INERT, INERT_SETTINGS, type DesktopStoreDeps } from './desktop-store';

const capabilities = { platform: 'linux', lockEvents: ['suspend'], badge: false, statusItem: true, jumpList: false, dockMenu: false, notifications: 'granted', translucency: 'unavailable', loginItem: true } as const;
const stored: DesktopSettings = { hideOnBlur: true, startAtLogin: false, closeBehavior: 'quit', theme: 'dark' };

function fakeBridge(overrides: Partial<DesktopBridge['settings']> = {}) {
  let onChanged: ((settings: typeof stored) => void) | undefined;
  const bridge = {
    settings: {
      get: vi.fn(async () => ({ settings: stored, capabilities })),
      set: vi.fn(async (change: object) => ({ settings: { ...stored, ...change }, applied: { startAtLogin: true } })),
      ...overrides,
    },
    onSettingsChanged: vi.fn((listener: typeof onChanged) => {
      onChanged = listener;
      return () => undefined;
    }),
  } as unknown as DesktopBridge;
  return { bridge, changed: (settings: typeof stored) => onChanged?.(settings) };
}

const deps = (over: Partial<DesktopStoreDeps>): DesktopStoreDeps => ({ isDesktop: () => true, platform: () => 'linux', loadBridge: async () => undefined, ...over });
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the desktop store in a browser', () => {
  it('stays inert and never loads or calls the bridge', async () => {
    const loadBridge = vi.fn(async () => undefined);
    const store = createDesktopStore(deps({ isDesktop: () => false, loadBridge }));
    store.start();
    await settled();
    expect(store.getSnapshot()).toBe(INERT);
    expect(loadBridge).not.toHaveBeenCalled();
    await expect(store.update({ hideOnBlur: true })).resolves.toBeUndefined();
  });
});

describe('the desktop store in the desktop app', () => {
  it('knows it is the desktop app and the platform before the shell answers, then takes its settings and capabilities', async () => {
    const { bridge } = fakeBridge();
    const store = createDesktopStore(deps({ platform: () => 'darwin', loadBridge: async () => bridge }));
    store.start();
    expect(store.getSnapshot()).toMatchObject({ isDesktop: true, platform: 'darwin', ready: false, settings: INERT_SETTINGS });
    await settled();
    expect(store.getSnapshot()).toMatchObject({ ready: true, settings: stored, capabilities });
  });

  it('keeps the defaults when the shell cannot answer', async () => {
    const { bridge } = fakeBridge({ get: vi.fn(async () => Promise.reject(new Error('x'))) });
    const store = createDesktopStore(deps({ loadBridge: async () => bridge }));
    store.start();
    await settled();
    expect(store.getSnapshot()).toMatchObject({ isDesktop: true, ready: true, settings: INERT_SETTINGS, capabilities: undefined });
  });

  it('keeps what the shell answers to a change, and follows changes made elsewhere', async () => {
    const { bridge, changed } = fakeBridge();
    const store = createDesktopStore(deps({ loadBridge: async () => bridge }));
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();
    await settled();
    await expect(store.update({ startAtLogin: true })).resolves.toEqual({ startAtLogin: true });
    expect(store.getSnapshot().settings.startAtLogin).toBe(true);
    changed({ ...stored, hideOnBlur: false });
    expect(store.getSnapshot().settings.hideOnBlur).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('starts once', async () => {
    const { bridge } = fakeBridge();
    const loadBridge = vi.fn(async () => bridge);
    const store = createDesktopStore(deps({ loadBridge }));
    store.start();
    store.start();
    expect(loadBridge).toHaveBeenCalledTimes(1);
  });
});

describe('DesktopSettingsProvider', () => {
  function Probe() {
    const { isDesktop, platform, settings } = useDesktop();
    return <p>{`${String(isDesktop)}|${String(platform)}|${String(settings.hideOnBlur)}`}</p>;
  }

  it('renders the inert defaults first, so the server and the first client render agree', () => {
    const store = createDesktopStore(deps({}));
    expect(renderToStaticMarkup(<DesktopSettingsProvider store={store}><Probe /></DesktopSettingsProvider>)).toContain('false|undefined|false');
  });

  it('gives the inert defaults outside a provider', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('false|undefined|false');
  });
});
