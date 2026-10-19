import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import type { CredentialStorePort, DeviceCredentials, RegisterExistingCryptoPort, RegistrationPayload, RegistrationResult, Secret } from '../ports/index';
import { registerExisting } from './register-existing';

const secret = (): Secret => {
  let bytes: Uint8Array | null = new Uint8Array(32).fill(1);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const OLD: DeviceCredentials = { deviceId: id(1), accountId: 'ABCDEF', email: 'a@example.com', server: 'https://old.example.com', registration: 'pending', sealed: new Uint8Array([1]) };

function setup(o: { stored?: DeviceCredentials | undefined; wrongPassword?: boolean; result?: RegistrationResult } = {}) {
  let stored: DeviceCredentials | undefined = 'stored' in o ? o.stored : OLD;
  const account = { encSk: secret(), sigSk: secret(), srpX: secret() };
  const payloads: Array<{ payload: RegistrationPayload; options: unknown }> = [];
  const crypto: RegisterExistingCryptoPort = {
    async prepare({ password }) {
      expect(password.isWiped).toBe(false);
      return o.wrongPassword ? 'wrong_password' : {
        registration: { accountId: 'ABCDEF', deviceId: id(1), keySet: new Uint8Array([9]), deviceSigPk: new Uint8Array(32), srpVerifier: new Uint8Array(512), authSalt: new Uint8Array(16), kdf: { mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16) } } as never,
        sealed: new Uint8Array([2, 2]), account, publicKeys: { enc: new Uint8Array(32), sig: new Uint8Array(32) },
      };
    },
  };
  const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
  const run = registerExisting({ crypto, credentials, registration: { register: async (payload, options) => (payloads.push({ payload, options }), o.result ?? { ok: true }) } });
  return { run, payloads, getStored: () => stored, account };
}

describe('registerExisting (T200)', () => {
  it('registers with the stored email and the chosen service, then stores the new sealed credentials as registered', async () => {
    const s = setup();
    const password = secret();
    const r = await s.run({ password, server: 'https://new.example.com/' });
    expect(r).toMatchObject({ ok: true, value: { server: 'https://new.example.com' } });
    expect(s.payloads[0]!.payload).toMatchObject({ accountId: 'ABCDEF', email: 'a@example.com', server: 'https://new.example.com' });
    expect(s.getStored()).toMatchObject({ registration: 'done', server: 'https://new.example.com', sealed: new Uint8Array([2, 2]), deviceId: id(1) });
    expect(password.isWiped).toBe(true);
    expect(s.account.encSk.isWiped).toBe(false); // handed on to the session
  });

  it('defaults to the address chosen at sign-up and passes an invitation code on', async () => {
    const s = setup();
    const r = await s.run({ password: secret(), inviteCode: 'let-me-in' });
    expect(r).toMatchObject({ ok: true, value: { server: 'https://old.example.com' } });
    expect(s.payloads[0]!.options).toEqual({ inviteCode: 'let-me-in' });
  });

  it('leaves everything as it was when the password is wrong', async () => {
    const s = setup({ wrongPassword: true });
    const password = secret();
    expect(await s.run({ password })).toMatchObject({ ok: false, error: { code: 'wrong_password' } });
    expect(s.payloads).toEqual([]);
    expect(s.getStored()).toEqual(OLD);
    expect(password.isWiped).toBe(true);
  });

  it.each([
    [{ ok: false, reason: 'offline' }, 'offline'], [{ ok: false, reason: 'email_taken' }, 'email_taken'], [{ ok: false, reason: 'invite_required' }, 'invite_required'],
    [{ ok: false, reason: 'rate_limited' }, 'rate_limited'], [{ ok: false, reason: 'rejected' }, 'rejected'],
  ] as const)('keeps the account local-only and wipes the keys when the service answers %j', async (result, code) => {
    const s = setup({ result });
    expect(await s.run({ password: secret() })).toMatchObject({ ok: false, error: { code } });
    expect(s.getStored()).toEqual(OLD);
    expect(s.account.encSk.isWiped && s.account.sigSk.isWiped && s.account.srpX.isWiped).toBe(true);
  });

  it('refuses when there is no account, when it is already registered, or when the address is not valid', async () => {
    const none = setup({ stored: undefined });
    const p1 = secret();
    expect(await none.run({ password: p1 })).toMatchObject({ ok: false, error: { code: 'no_account' } });
    expect(p1.isWiped).toBe(true);
    const done = setup({ stored: { ...OLD, registration: 'done' } });
    expect(await done.run({ password: secret() })).toMatchObject({ ok: false, error: { code: 'already_registered' } });
    const bad = setup();
    const p2 = secret();
    expect(await bad.run({ password: p2, server: 'ftp://nope' })).toMatchObject({ ok: false, error: { code: 'invalid_server' } });
    expect(p2.isWiped).toBe(true);
  });
});
