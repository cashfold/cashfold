import { describe, expect, it, vi } from 'vitest';
import { getDesktopBridge } from './index';

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
  dataPath: '/Users/x/Library/Application Support/Cashfold',
  sourceUrl: 'https://github.com/cashfold/cashfold/tree/v1.2.3',
};

function rawBridge(overrides: Record<string, unknown> = {}) {
  const listeners: Array<(state: unknown) => void> = [];
  const updates = {
    state: vi.fn(async () => ({ kind: 'idle' })),
    check: vi.fn(async () => ({ kind: 'none' })),
    download: vi.fn(async () => ({ kind: 'downloading', version: '1.3.0', percent: 5 })),
    install: vi.fn(async () => undefined),
    openReleasePage: vi.fn(async () => undefined),
    autoCheck: vi.fn(async () => true),
    setAutoCheck: vi.fn(async () => undefined),
    onChange: vi.fn((listener: (state: unknown) => void) => {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    }),
  };
  return { raw: { about: vi.fn(async () => about), revealDataFolder: vi.fn(async () => undefined), updates: { ...updates, ...overrides } }, updates, emit: (state: unknown) => listeners.forEach((l) => l(state)) };
}

describe('finding the desktop bridge', () => {
  it('is undefined in the plain web app, and the web app never goes looking elsewhere', () => {
    expect(getDesktopBridge({})).toBeUndefined();
    expect(getDesktopBridge({ cashfoldDesktop: undefined })).toBeUndefined();
    expect(getDesktopBridge({ cashfoldDesktop: null })).toBeUndefined();
    expect(getDesktopBridge({ cashfoldDesktop: 'yes' })).toBeUndefined();
    expect(getDesktopBridge({ electron: {}, ipcRenderer: {}, require: () => undefined })).toBeUndefined();
  });

  it('is undefined for an object that is not a bridge', () => {
    expect(getDesktopBridge({ cashfoldDesktop: {} })).toBeUndefined();
    expect(getDesktopBridge({ cashfoldDesktop: { about: () => undefined } })).toBeUndefined();
  });

  it('gives the page the same checked wrapper every time for the same bridge', () => {
    const host = { cashfoldDesktop: rawBridge().raw };
    expect(getDesktopBridge(host)).toBe(getDesktopBridge(host));
  });
});

describe('answers are checked before the page sees them', () => {
  it('passes a valid description of the app', async () => {
    const { raw } = rawBridge();
    await expect(getDesktopBridge({ cashfoldDesktop: raw })!.about()).resolves.toEqual(about);
  });

  it('refuses a description that is not in the contract', async () => {
    const { raw } = rawBridge();
    raw.about = vi.fn(async () => ({ ...about, os: 'plan9' }));
    await expect(getDesktopBridge({ cashfoldDesktop: raw })!.about()).rejects.toThrow();
  });

  it('turns an invalid update state, or a failing call, into an error state, not an exception for the UI', async () => {
    const { raw } = rawBridge({ state: vi.fn(async () => ({ kind: 'installing' })), check: vi.fn(async () => { throw new Error('boom /secret/path'); }), download: vi.fn(async () => 'text') });
    const bridge = getDesktopBridge({ cashfoldDesktop: raw })!;
    for (const call of [bridge.updates.state, bridge.updates.check, bridge.updates.download]) await expect(call()).resolves.toEqual({ kind: 'error', code: 'unknown' });
  });

  it('passes valid update states through', async () => {
    const { raw } = rawBridge();
    const bridge = getDesktopBridge({ cashfoldDesktop: raw })!;
    await expect(bridge.updates.state()).resolves.toEqual({ kind: 'idle' });
    await expect(bridge.updates.check()).resolves.toEqual({ kind: 'none' });
    await expect(bridge.updates.download()).resolves.toEqual({ kind: 'downloading', version: '1.3.0', percent: 5 });
  });

  it('ignores update events that are not states, and can stop listening', () => {
    const { raw, emit } = rawBridge();
    const listener = vi.fn();
    const stop = getDesktopBridge({ cashfoldDesktop: raw })!.updates.onChange(listener);
    emit({ kind: 'checking' });
    emit({ kind: 'bogus' });
    emit(null);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    emit({ kind: 'checking' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the setting as a boolean', async () => {
    const { raw } = rawBridge({ autoCheck: vi.fn(async () => 'maybe') });
    await expect(getDesktopBridge({ cashfoldDesktop: raw })!.updates.autoCheck()).resolves.toBe(true);
  });
});
