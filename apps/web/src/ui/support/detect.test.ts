import { describe, expect, it } from 'vitest';
import { detectSupport, REQUIRED_FEATURES, type SupportEnv } from './detect.js';

const full = (): SupportEnv => ({
  isSecureContext: true,
  navigator: { storage: { getDirectory: () => Promise.resolve({}) }, locks: { request: () => Promise.resolve() } },
  crypto: { subtle: {}, getRandomValues: () => undefined },
  Worker: class {},
  WebAssembly: { instantiate: () => Promise.resolve({}) },
  BroadcastChannel: class {},
  FileSystemFileHandle: { prototype: { createSyncAccessHandle: () => Promise.resolve({}) } },
});

describe('detectSupport', () => {
  it('reports nothing missing in a capable browser', () => {
    expect(detectSupport(full())).toEqual({ supported: true, missing: [] });
  });

  it.each([
    ['secure_context', (e: SupportEnv) => ({ ...e, isSecureContext: false })],
    ['opfs', (e: SupportEnv) => ({ ...e, navigator: { ...e.navigator, storage: {} } })],
    ['opfs', (e: SupportEnv) => ({ ...e, navigator: { locks: e.navigator.locks } })],
    ['opfs', (e: SupportEnv) => ({ ...e, FileSystemFileHandle: { prototype: {} } })],
    ['opfs', (e: SupportEnv) => ({ ...e, FileSystemFileHandle: undefined })],
    ['webcrypto', (e: SupportEnv) => ({ ...e, crypto: { getRandomValues: () => undefined } })],
    ['webcrypto', (e: SupportEnv) => ({ ...e, crypto: undefined })],
    ['workers', (e: SupportEnv) => ({ ...e, Worker: undefined })],
    ['wasm', (e: SupportEnv) => ({ ...e, WebAssembly: undefined })],
    ['locks', (e: SupportEnv) => ({ ...e, navigator: { storage: e.navigator.storage } })],
    ['broadcast', (e: SupportEnv) => ({ ...e, BroadcastChannel: undefined })],
  ] as const)('flags %s when it is unavailable', (feature, degrade) => {
    expect(detectSupport(degrade(full()))).toEqual({ supported: false, missing: [feature] });
  });

  it('lists every missing feature once, in a stable order', () => {
    const bare: SupportEnv = { isSecureContext: false, navigator: {}, crypto: undefined, Worker: undefined, WebAssembly: undefined, BroadcastChannel: undefined, FileSystemFileHandle: undefined };
    const result = detectSupport(bare);
    expect(result.supported).toBe(false);
    expect(result.missing).toEqual([...REQUIRED_FEATURES]);
  });

  it('never throws on a hostile environment', () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('nope'); } }) as unknown as SupportEnv;
    expect(() => detectSupport(hostile)).not.toThrow();
    expect(detectSupport(hostile).supported).toBe(false);
  });
});
