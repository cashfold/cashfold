import { describe, expect, it, vi } from 'vitest';
import { id } from '../../testing/world';
import type { CredentialStorePort, DeviceCredentials, Secret, SessionPort, SessionServices, UnlockCryptoPort, UnlockedMaterial } from '../ports/index';
import { createSession } from './lock';
import { unlock } from './unlock';

const secret = (fill = 1): Secret => {
  let bytes: Uint8Array | null = new Uint8Array(32).fill(fill);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const credentials: DeviceCredentials = { deviceId: id(0xd1), accountId: 'XRG88A', email: 'a@example.com', server: 'https://relay.example.com', registration: 'done', sealed: new Uint8Array([1]) };

function setup(opts: { stored?: DeviceCredentials | undefined; verdict?: 'ok' | 'wrong_password' } = {}) {
  let now = 1_000;
  const session = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => now });
  const material: UnlockedMaterial = { sessionKey: secret(1), deviceSigningKey: secret(2), secretKey: secret(3) };
  const unlockCrypto: UnlockCryptoPort = { unlock: vi.fn(async ({ password }) => { password.wipe(); return opts.verdict === 'wrong_password' ? 'wrong_password' : material; }) };
  const store: CredentialStorePort = { save: async () => undefined, load: async () => ('stored' in opts ? opts.stored : credentials), clear: async () => undefined };
  const services = {} as SessionServices;
  const sessionPort: SessionPort = { start: vi.fn(async () => services), stop: async () => undefined };
  const run = (password = secret(7)) => unlock({ unlockCrypto, credentials: store, sessionPort, session })({ password });
  return { run, session, material, unlockCrypto, sessionPort, services, advance: (ms: number) => void (now += ms) };
}

describe('unlock', () => {
  it('opens the session with the right password and returns what the unlock screen may show', async () => {
    const s = setup();
    const r = await s.run();
    expect(r).toEqual({ ok: true, value: { accountId: 'XRG88A', email: 'a@example.com', server: 'https://relay.example.com', services: s.services, deviceId: credentials.deviceId } });
    expect(s.sessionPort.start).toHaveBeenCalledWith({ deviceId: credentials.deviceId, sessionKey: s.material.sessionKey, deviceSigningKey: s.material.deviceSigningKey });
  });

  it('puts every unlocked secret under the lock controller', async () => {
    const s = setup();
    await s.run();
    expect([s.material.sessionKey.isWiped, s.material.deviceSigningKey.isWiped, s.material.secretKey.isWiped]).toEqual([false, false, false]);
    await s.session.lock();
    expect([s.material.sessionKey.isWiped, s.material.deviceSigningKey.isWiped, s.material.secretKey.isWiped]).toEqual([true, true, true]);
  });

  it('says only that the password was wrong, and starts nothing', async () => {
    const s = setup({ verdict: 'wrong_password' });
    expect(await s.run()).toEqual({ ok: false, error: expect.objectContaining({ code: 'wrong_password' }) });
    expect(s.sessionPort.start).not.toHaveBeenCalled();
  });

  it('slows down repeated wrong guesses and refuses to try during the wait, without touching the password', async () => {
    const s = setup({ verdict: 'wrong_password' });
    for (let i = 0; i < 4; i++) await s.run();
    const pw = secret(9);
    const blocked = await s.run(pw);
    expect(blocked).toEqual({ ok: false, error: expect.objectContaining({ code: 'too_many_attempts', retryAfterMs: expect.any(Number) }) });
    expect(pw.isWiped).toBe(true);
    expect(s.unlockCrypto.unlock).toHaveBeenCalledTimes(4); // the fifth attempt never reached the key derivation
    s.advance(20 * 60_000);
    expect(await s.run()).toEqual({ ok: false, error: expect.objectContaining({ code: 'wrong_password' }) });
  });

  it('a correct password clears the penalty', async () => {
    const wrong = setup({ verdict: 'wrong_password' });
    for (let i = 0; i < 5; i++) await wrong.run();
    expect(wrong.session.unlockDelayMs()).toBeGreaterThan(0);
    const right = setup();
    right.session.recordFailedUnlock();
    await right.run();
    expect(right.session.unlockDelayMs()).toBe(0);
  });

  it('reports a device with no account instead of failing obscurely', async () => {
    const s = setup({ stored: undefined });
    const pw = secret();
    expect(await s.run(pw)).toEqual({ ok: false, error: expect.objectContaining({ code: 'no_account' }) });
    expect(pw.isWiped).toBe(true);
  });

  it('stops the session and wipes the secrets if starting it fails', async () => {
    const s = setup();
    (s.sessionPort.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db corrupt'));
    await expect(s.run()).rejects.toThrow('db corrupt');
    expect(s.material.sessionKey.isWiped).toBe(true);
    expect(s.material.deviceSigningKey.isWiped).toBe(true);
    expect(s.material.secretKey.isWiped).toBe(true);
  });
});
