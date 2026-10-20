import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import type { CredentialChangeCryptoPort, CredentialStorePort, DeviceCredentials, KdfOffer, PreparedRotation, RelayAuthPort, RelayLink, RelayReply, Secret } from '../ports/index';
import { changeCredentials } from './credential-change';
import { createSession } from './lock';

const textSecret = (text: string): Secret => {
  let bytes: Uint8Array | null = new TextEncoder().encode(text);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const GOOD: KdfOffer = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16) };
const OLD = new Uint8Array([1, 1, 1]);
const NEW = new Uint8Array([2, 2, 2]);

interface Opts { wrongPassword?: boolean; offer?: KdfOffer; signIn?: 'rejected' | 'offline'; put?: RelayReply; keyset?: RelayReply; registration?: 'pending' | 'done'; noAccount?: boolean }

function setup(o: Opts = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const events: string[] = [];
  let prepareArgs: { rotateSecretKey: boolean; newPassword?: string } | undefined;
  const crypto: CredentialChangeCryptoPort = {
    async begin({ password }) {
      password.wipe();
      if (o.wrongPassword) return 'wrong_password';
      return {
        currentSrpX: async () => textSecret('x'),
        async prepare(args) {
          prepareArgs = { rotateSecretKey: args.rotateSecretKey, ...(args.newPassword !== undefined && { newPassword: args.newPassword.use((b) => new TextDecoder().decode(b)) }) };
          args.newPassword?.wipe();
          const out: PreparedRotation = {
            rotation: { authSalt: new Uint8Array(16).fill(3), kdf: { mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16).fill(4) }, srpVerifier: new Uint8Array(512).fill(5), keySet: new Uint8Array([9, 9]) },
            sealed: NEW, srpX: textSecret('new-x'), ...(args.rotateSecretKey && { secretKeyText: 'C1-NEW' }),
          };
          return out;
        },
        wipe: () => void events.push('handle.wipe'),
      };
    },
  };
  const link: RelayLink = {
    freshProof: new Uint8Array(32), close: () => void events.push('link.close'),
    async request(method, path, body) {
      requests.push({ method, path, ...(body !== undefined && { body }) });
      if (method === 'GET') return o.keyset ?? { ok: true, status: 200, body: new Map([['keyset', new Uint8Array([7])]]) };
      return o.put ?? { ok: true, status: 204, body: null };
    },
  };
  const relay: RelayAuthPort = {
    async signIn({ deriveX }) {
      if (o.signIn) return { ok: false, kind: o.signIn };
      await deriveX({ authSalt: new Uint8Array(16), kdf: o.offer ?? GOOD });
      return { ok: true, accountId: 'ABCDEF', link };
    },
  };
  let stored: DeviceCredentials | undefined = o.noAccount ? undefined : { deviceId: id(1), accountId: 'ABCDEF', email: 'a@b.cc', server: 'https://relay.example', registration: o.registration ?? 'done', sealed: OLD };
  const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
  const session = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => 0 });
  const run = changeCredentials({ crypto, relay, credentials, session });
  return { run, requests, events, credentials: () => stored, prepared: () => prepareArgs };
}
const NEW_PASSWORD = 'a much longer passphrase 7731';

describe('changeCredentials (FR-008)', () => {
  it('replaces the password: the key set is re-wrapped, the service swaps everything in one request, then the device follows', async () => {
    const s = setup();
    const current = textSecret('old password here 1');
    const next = textSecret(NEW_PASSWORD);
    const r = await s.run({ password: current, newPassword: next });
    expect(r).toMatchObject({ ok: true, value: { otherDevicesSignedOut: true } });
    expect(s.prepared()).toEqual({ rotateSecretKey: false, newPassword: NEW_PASSWORD });
    expect(s.requests.map((q) => `${q.method} ${q.path}`)).toEqual(['GET /accounts/me/keyset', 'PUT /accounts/me/keyset']);
    const put = s.requests[1]!.body as Record<string, unknown>;
    expect(Object.keys(put).sort()).toEqual(['auth_salt', 'kdf', 'keyset', 'srp_verifier']);
    expect(put['kdf']).toMatchObject({ kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n });
    expect(s.credentials()!.sealed).toEqual(NEW);
    expect(s.credentials()!).toMatchObject({ email: 'a@b.cc', server: 'https://relay.example', registration: 'done' });
    expect(current.isWiped && next.isWiped).toBe(true);
    expect(s.events).toEqual(['link.close', 'handle.wipe']);
  });

  it('rotates the Secret Key and hands back the new one to show once', async () => {
    const s = setup();
    const r = await s.run({ password: textSecret('old password here 1'), rotateSecretKey: true });
    expect(r).toMatchObject({ ok: true, value: { secretKeyText: 'C1-NEW' } });
    expect(s.prepared()).toEqual({ rotateSecretKey: true });
  });

  it('refuses a wrong current password before the service is contacted', async () => {
    const s = setup({ wrongPassword: true });
    const next = textSecret(NEW_PASSWORD);
    expect(await s.run({ password: textSecret('nope nope nope'), newPassword: next })).toMatchObject({ ok: false, error: { code: 'wrong_password' } });
    expect(s.requests).toEqual([]);
    expect(next.isWiped).toBe(true);
    expect(s.credentials()!.sealed).toEqual(OLD);
  });

  it('refuses a weak, unchanged or missing new password without touching anything', async () => {
    const s = setup();
    for (const [input, code] of [
      [{ password: textSecret('old password here 1'), newPassword: textSecret('short') }, 'weak_password'],
      [{ password: textSecret(NEW_PASSWORD), newPassword: textSecret(NEW_PASSWORD) }, 'same_password'],
      [{ password: textSecret('old password here 1') }, 'nothing_to_change'],
    ] as const) {
      expect(await s.run(input)).toMatchObject({ ok: false, error: { code } });
      expect(input.password.isWiped).toBe(true);
    }
    expect(s.requests).toEqual([]);
  });

  it('leaves the device as it was when the service does not accept the change', async () => {
    const s = setup({ put: { ok: false, kind: 'offline' } });
    expect(await s.run({ password: textSecret('old password here 1'), newPassword: textSecret(NEW_PASSWORD) })).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(s.credentials()!.sealed).toEqual(OLD);
    expect(s.events).toEqual(['link.close', 'handle.wipe']);
  });

  it('maps sign-in failures, refuses weak service settings, and needs a registered account', async () => {
    expect(await setup({ signIn: 'rejected' }).run({ password: textSecret('old password here 1'), newPassword: textSecret(NEW_PASSWORD) })).toMatchObject({ ok: false, error: { code: 'wrong_credentials' } });
    expect(await setup({ signIn: 'offline' }).run({ password: textSecret('old password here 1'), newPassword: textSecret(NEW_PASSWORD) })).toMatchObject({ ok: false, error: { code: 'offline' } });
    const weak = setup({ offer: { kdf: 'argon2id', mKib: 1024, t: 1, p: 1, encSalt: new Uint8Array(16) } });
    expect(await weak.run({ password: textSecret('old password here 1'), newPassword: textSecret(NEW_PASSWORD) })).toMatchObject({ ok: false, error: { code: 'kdf_below_floor' } });
    expect(weak.requests).toEqual([]);
    expect(await setup({ registration: 'pending' }).run({ password: textSecret('x'), rotateSecretKey: true })).toMatchObject({ ok: false, error: { code: 'not_registered' } });
    expect(await setup({ noAccount: true }).run({ password: textSecret('x'), rotateSecretKey: true })).toMatchObject({ ok: false, error: { code: 'no_account' } });
  });

  it('reports a malformed key set reply as a service error', async () => {
    const s = setup({ keyset: { ok: true, status: 200, body: new Map() } });
    expect(await s.run({ password: textSecret('old password here 1'), rotateSecretKey: true })).toMatchObject({ ok: false, error: { code: 'service_error' } });
  });
});
