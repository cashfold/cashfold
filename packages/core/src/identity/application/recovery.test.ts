import { describe, expect, it } from 'vitest';
import { ok } from '../../shared-kernel/result';
import { id } from '../../testing/index';
import type {
  AccountSecrets, CredentialChangeCryptoPort, CredentialStorePort, DeviceCredentials, KdfOffer, RecoveryCryptoPort, RecoveryHandle, RelayAuthPort, RelayErrorKind, RelayLink, RelayReply, Secret,
} from '../ports/index';
import { recoverAccount, removeRecoveryKey, setRecoveryKey } from './recovery';
import type { SignedIn, SignInInput } from './sign-in';

const textSecret = (text: string): Secret => {
  let bytes: Uint8Array | null = new TextEncoder().encode(text);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const GOOD: KdfOffer = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16) };
const account: AccountSecrets = { encSk: textSecret('e'), sigSk: textSecret('s'), srpX: textSecret('x') };
const NEW_PASSWORD = 'a much longer passphrase 7731';
const RK = 'R1-AAAAA-BBBBB';

interface Opts {
  signIn?: RelayErrorKind; materialReply?: RelayReply; put?: RelayReply; wrongKey?: boolean; invalidKey?: boolean; wrongPassword?: boolean; offer?: KdfOffer;
  existing?: boolean; registration?: 'pending' | 'done'; signInResult?: 'ok' | 'fail'; locked?: boolean;
}

function setup(o: Opts = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const events: string[] = [];
  let credentialSeen: string | undefined;
  const link: RelayLink = {
    freshProof: new Uint8Array(32), close: () => void events.push('link.close'),
    async request(method, path, body) {
      requests.push({ method, path, ...(body !== undefined && { body }) });
      if (method === 'GET') return o.materialReply ?? { ok: true, status: 200, body: new Map<string, Uint8Array>([['uuid', new Uint8Array(16)], ['wrapped', new Uint8Array([5, 5])], ['keyset', new Uint8Array([6])]]) };
      return o.put ?? { ok: true, status: 204, body: null };
    },
  };
  const relay: RelayAuthPort = {
    async signIn({ credential, deriveX }) {
      credentialSeen = credential;
      if (o.signIn) return { ok: false, kind: o.signIn };
      await deriveX({ authSalt: new Uint8Array(16), kdf: o.offer ?? GOOD });
      return { ok: true, accountId: 'ABCDEF', link };
    },
  };
  const handle: RecoveryHandle = {
    srpX: async () => textSecret('rk-x'),
    async restore({ newPassword }) {
      events.push(`restore with ${newPassword.use((b) => new TextDecoder().decode(b))}`);
      return o.wrongKey ? 'wrong_key' : { rotation: { authSalt: new Uint8Array(16).fill(1), kdf: { mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16).fill(2) }, srpVerifier: new Uint8Array(512).fill(3), keySet: new Uint8Array([8]) }, secretKeyText: 'C1-ABCDEF-NEWSECRET' };
    },
    wipe: () => void events.push('handle.wipe'),
  };
  const crypto: RecoveryCryptoPort = {
    create: async () => ({ recoveryKeyText: RK, payload: { uuid: new Uint8Array(16).fill(4), authSalt: new Uint8Array(16).fill(5), srpVerifier: new Uint8Array(512).fill(6), wrapped: new Uint8Array(92).fill(7) } }),
    begin: async () => (o.invalidKey ? 'invalid_recovery_key' : handle),
  };
  const verify: CredentialChangeCryptoPort = {
    async begin({ password }) {
      password.wipe();
      return o.wrongPassword ? 'wrong_password' : { currentSrpX: async () => textSecret('x'), prepare: async () => { throw new Error('unused'); }, wipe: () => void events.push('verify.wipe') };
    },
  };
  let stored: DeviceCredentials | undefined = o.existing ? { deviceId: id(1), accountId: 'ABCDEF', email: 'a@b.cc', server: 'https://relay.example', registration: o.registration ?? 'done', sealed: new Uint8Array() } : undefined;
  const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
  const signedInWith: SignInInput[] = [];
  const signedIn: SignedIn = { accountId: 'ABCDEF', folds: [], deviceId: id(9), sync: { account, publicKeys: { enc: new Uint8Array(32), sig: new Uint8Array(32) } } };
  const recover = recoverAccount({
    crypto, relay, credentials, random: { bytes: (n) => new Uint8Array(n).fill(7) },
    signIn: async (input) => {
      signedInWith.push(input);
      return o.signInResult === 'fail' ? { ok: false, error: { code: 'wrong_credentials', message: 'x' } } : ok(signedIn);
    },
  });
  const set = setRecoveryKey({ crypto, verify, relay, credentials, account: () => (o.locked ? undefined : account) });
  const remove = removeRecoveryKey({ verify, relay, credentials });
  return { recover, set, remove, requests, events, credentialSeen: () => credentialSeen, signedInWith };
}

const input = (over: Partial<Parameters<ReturnType<typeof setup>['recover']>[0]> = {}) => ({ email: 'Alice@Example.com', server: 'https://relay.example.com', recoveryKeyText: RK, newPassword: textSecret(NEW_PASSWORD), ...over });

describe('setRecoveryKey (FR-009)', () => {
  it('proves the password again, stores the credential at the service and returns the key to show once', async () => {
    const s = setup({ existing: true });
    const pw = textSecret('current password 1');
    expect(await s.set({ password: pw })).toEqual({ ok: true, value: { recoveryKeyText: RK } });
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject({ method: 'PUT', path: '/accounts/me/recovery' });
    expect(Object.keys(s.requests[0]!.body as object).sort()).toEqual(['auth_salt', 'srp_verifier', 'uuid', 'wrapped']);
    expect(s.events).toContain('link.close');
    expect(s.credentialSeen()).toBeUndefined();
  });

  it('needs the app unlocked, the right password and a registered account', async () => {
    expect(await setup({ existing: true, locked: true }).set({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'locked' } });
    expect(await setup({ existing: true, wrongPassword: true }).set({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'wrong_password' } });
    expect(await setup({ existing: true, registration: 'pending' }).set({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'not_registered' } });
    expect(await setup().set({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'no_account' } });
  });

  it('reports a service that cannot be reached without claiming success', async () => {
    const s = setup({ existing: true, put: { ok: false, kind: 'offline' } });
    expect(await s.set({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'offline' } });
  });

  it('removes the credential at the service', async () => {
    const s = setup({ existing: true });
    expect(await s.remove({ password: textSecret('x') })).toEqual({ ok: true, value: true });
    expect(s.requests).toEqual([{ method: 'DELETE', path: '/accounts/me/recovery' }]);
    expect(await setup({ existing: true, wrongPassword: true }).remove({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'wrong_password' } });
  });
});

describe('recoverAccount (FR-009)', () => {
  it('signs in with the Recovery Key, replaces password and Secret Key at once, then enrols this device with the new ones', async () => {
    const s = setup();
    const pw = textSecret(NEW_PASSWORD);
    const r = await s.recover(input({ newPassword: pw }));
    expect(r).toMatchObject({ ok: true, value: { accountId: 'ABCDEF', secretKeyText: 'C1-ABCDEF-NEWSECRET' } });
    expect(s.credentialSeen()).toBe('recovery');
    expect(s.requests.map((q) => `${q.method} ${q.path}`)).toEqual(['GET /accounts/me/recovery', 'PUT /accounts/me/keyset']);
    expect(s.events).toContain(`restore with ${NEW_PASSWORD}`);
    expect(s.signedInWith).toHaveLength(1);
    expect(s.signedInWith[0]).toMatchObject({ email: 'alice@example.com', server: 'https://relay.example.com', secretKeyText: 'C1-ABCDEF-NEWSECRET' });
    expect(s.signedInWith[0]!.password).toBe(pw); // handed on to the sign-in, which wipes it
    expect(s.events.slice(-2)).toEqual(['link.close', 'handle.wipe']);
  });

  it('says the same thing for a wrong key, an unknown address and an account with no Recovery Key', async () => {
    for (const opts of [{ signIn: 'rejected' }, { wrongKey: true }] as const) {
      const pw = textSecret(NEW_PASSWORD);
      expect(await setup(opts).recover(input({ newPassword: pw }))).toMatchObject({ ok: false, error: { code: 'wrong_recovery_key' } });
      expect(pw.isWiped).toBe(true);
    }
    const s = setup({ signIn: 'rejected' });
    await s.recover(input());
    expect(s.requests).toEqual([]);
  });

  it('refuses text that is not a Recovery Key, a weak password and a device that already has an account, before contacting the service', async () => {
    const s = setup({ invalidKey: true });
    expect(await s.recover(input())).toMatchObject({ ok: false, error: { code: 'invalid_recovery_key' } });
    expect(await setup().recover(input({ newPassword: textSecret('short') }))).toMatchObject({ ok: false, error: { code: 'weak_password' } });
    expect(await setup({ existing: true }).recover(input())).toMatchObject({ ok: false, error: { code: 'already_has_account' } });
    expect(await setup().recover(input({ email: 'nope' }))).toMatchObject({ ok: false, error: { code: 'invalid_email' } });
    expect(await setup().recover(input({ server: 'nope' }))).toMatchObject({ ok: false, error: { code: 'invalid_server' } });
    expect(s.requests).toEqual([]);
  });

  it('does not sign this device in when the service did not take the new credentials', async () => {
    const s = setup({ put: { ok: false, kind: 'offline' } });
    expect(await s.recover(input())).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(s.signedInWith).toEqual([]);
  });

  it('refuses weak service settings and reports a service that has no Recovery Key stored', async () => {
    const weak = setup({ offer: { kdf: 'argon2id', mKib: 1024, t: 1, p: 1, encSalt: new Uint8Array(16) } });
    expect(await weak.recover(input())).toMatchObject({ ok: false, error: { code: 'kdf_below_floor' } });
    expect(await setup({ materialReply: { ok: false, kind: 'not_found' } }).recover(input())).toMatchObject({ ok: false, error: { code: 'no_recovery_key' } });
    expect(await setup({ materialReply: { ok: true, status: 200, body: new Map() } }).recover(input())).toMatchObject({ ok: false, error: { code: 'service_error' } });
  });

  it('passes on a failed enrolment of this device', async () => {
    expect(await setup({ signInResult: 'fail' }).recover(input())).toMatchObject({ ok: false, error: { code: 'wrong_credentials' } });
  });
});
