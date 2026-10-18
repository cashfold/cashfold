import { describe, expect, it, vi } from 'vitest';
import { id } from '../../testing/world';
import { DEFAULT_SETTINGS, type DeviceSettings } from '../domain/device-settings';
import type { CredentialStorePort, DeviceCredentials, DeviceSettingsPort, QuickUnlockCryptoPort, QuickUnlockStorePort, Secret, SessionPort, SessionServices, StoredQuickUnlock, UnlockedMaterial } from '../ports/index';
import { createSession } from './lock';
import { createQuickUnlock } from './quick-unlock';

const secret = (fill = 1): Secret => {
  let bytes: Uint8Array | null = new Uint8Array(32).fill(fill);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const credentials: DeviceCredentials = { deviceId: id(0xd1), accountId: 'XRG88A', email: 'a@example.com', server: 'https://relay.example.com', registration: 'done', sealed: new Uint8Array([1]) };
const PRF = new Uint8Array(32).fill(7);

function setup(over: { prfWorks?: boolean; passwordWorks?: boolean } = {}) {
  let now = 1_000_000;
  let stored: StoredQuickUnlock | undefined;
  let settings: DeviceSettings = DEFAULT_SETTINGS;
  const session = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => now });
  const material: UnlockedMaterial = { sessionKey: secret(1), deviceSigningKey: secret(2), secretKey: secret(3) };
  const crypto: QuickUnlockCryptoPort = {
    enroll: vi.fn(async ({ password }) => { password.wipe(); return over.passwordWorks === false ? 'wrong_password' : new Uint8Array([9, 9]); }),
    unlock: vi.fn(async () => (over.prfWorks === false ? 'failed' : material)),
  };
  const store: QuickUnlockStorePort = { load: async () => stored, save: async (r) => void (stored = r), clear: async () => void (stored = undefined) };
  const settingsPort: DeviceSettingsPort = { load: async () => settings, save: async (s) => void (settings = s) };
  const credentialStore: CredentialStorePort = { save: async () => undefined, load: async () => credentials, clear: async () => undefined };
  const services = {} as SessionServices;
  const sessionPort: SessionPort = { start: vi.fn(async () => services), stop: async () => undefined };
  const quick = createQuickUnlock({ crypto, store, settings: settingsPort, credentials: credentialStore, sessionPort, session, nowMs: () => now });
  return { quick, crypto, session, material, services, sessionPort, advance: (ms: number) => void (now += ms), get stored() { return stored; }, get settings() { return settings; } };
}

const enrolArgs = (password = secret(5)) => ({ password, credentialId: new Uint8Array([1, 2, 3]), prfSalt: new Uint8Array(32).fill(4), prfOutput: PRF.slice(), sessionMarker: 'marker-1' });

describe('enrolling', () => {
  it('stores the wrapped key, turns the setting on, and wipes the password and PRF output', async () => {
    const s = setup();
    const args = enrolArgs();
    expect(await s.quick.enrol(args)).toEqual({ ok: true, value: true });
    expect(s.stored).toMatchObject({ blob: new Uint8Array([9, 9]), sessionMarker: 'marker-1', failures: 0 });
    expect(s.settings.quickUnlock.enabled).toBe(true);
    expect(args.password.isWiped).toBe(true);
    expect([...args.prfOutput]).toEqual(new Array(32).fill(0));
  });

  it('refuses with the wrong password and stores nothing', async () => {
    const s = setup({ passwordWorks: false });
    expect(await s.quick.enrol(enrolArgs())).toEqual({ ok: false, error: expect.objectContaining({ code: 'wrong_password' }) });
    expect(s.stored).toBeUndefined();
    expect(s.settings.quickUnlock.enabled).toBe(false);
  });

  it('counts a wrong password against the same back-off as unlocking', async () => {
    const s = setup({ passwordWorks: false });
    for (let i = 0; i < 4; i++) await s.quick.enrol(enrolArgs());
    expect(await s.quick.enrol(enrolArgs())).toEqual({ ok: false, error: expect.objectContaining({ code: 'too_many_attempts' }) });
  });
});

describe('unlocking with the device', () => {
  async function enrolled(over = {}) {
    const s = setup(over);
    await s.quick.enrol(enrolArgs());
    await s.quick.markLocked();
    s.advance(60_000);
    return s;
  }

  it('opens the session without a password', async () => {
    const s = await enrolled();
    const r = await s.quick.unlock({ prfOutput: PRF.slice(), sessionMarker: 'marker-1' });
    expect(r).toEqual({ ok: true, value: { accountId: 'XRG88A', email: 'a@example.com', server: 'https://relay.example.com', services: s.services } });
    expect(s.sessionPort.start).toHaveBeenCalledWith({ deviceId: credentials.deviceId, sessionKey: s.material.sessionKey, deviceSigningKey: s.material.deviceSigningKey });
    await s.session.lock();
    expect(s.material.sessionKey.isWiped).toBe(true);
  });

  it.each([
    ['after a browser restart', { sessionMarker: undefined }, 'browser_restarted'],
    ['from another browser session', { sessionMarker: 'marker-2' }, 'browser_restarted'],
  ])('is refused %s', async (_name, over, reason) => {
    const s = await enrolled();
    expect(await s.quick.unlock({ prfOutput: PRF.slice(), sessionMarker: 'marker-1', ...over })).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_allowed', reason }) });
    expect(s.crypto.unlock).not.toHaveBeenCalled();
  });

  it('is refused after the inactivity period', async () => {
    const s = await enrolled();
    s.advance(31 * 60_000);
    expect(await s.quick.unlock({ prfOutput: PRF.slice(), sessionMarker: 'marker-1' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_allowed', reason: 'idle_too_long' }) });
  });

  it('counts failures and then insists on the password', async () => {
    const s = await enrolled({ prfWorks: false });
    for (let i = 0; i < 3; i++) expect(await s.quick.unlock({ prfOutput: PRF.slice(), sessionMarker: 'marker-1' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'failed' }) });
    expect(s.stored?.failures).toBe(3);
    expect(await s.quick.unlock({ prfOutput: PRF.slice(), sessionMarker: 'marker-1' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_allowed', reason: 'too_many_failures' }) });
  });

  it('a password unlock clears the failure count', async () => {
    const s = await enrolled({ prfWorks: false });
    await s.quick.unlock({ prfOutput: PRF.slice(), sessionMarker: 'marker-1' });
    await s.quick.recordPasswordUnlock();
    expect(s.stored?.failures).toBe(0);
  });

  it('wipes the PRF output whatever the outcome', async () => {
    const s = await enrolled();
    const prf = PRF.slice();
    await s.quick.unlock({ prfOutput: prf, sessionMarker: 'marker-1' });
    expect([...prf]).toEqual(new Array(32).fill(0));
  });

  it('can be switched off, which forgets the wrapped key', async () => {
    const s = await enrolled();
    await s.quick.disable();
    expect(s.stored).toBeUndefined();
    expect(s.settings.quickUnlock.enabled).toBe(false);
    expect(await s.quick.status('marker-1')).toEqual({ allowed: false, reason: 'disabled' });
  });

  it('reports whether it is currently available, for the unlock screen', async () => {
    const s = await enrolled();
    expect(await s.quick.status('marker-1')).toMatchObject({ allowed: true, credentialId: new Uint8Array([1, 2, 3]), prfSalt: new Uint8Array(32).fill(4) });
    expect(await s.quick.status(undefined)).toEqual({ allowed: false, reason: 'browser_restarted' });
  });
});
