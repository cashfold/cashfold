import { describe, expect, it, vi } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { id } from '../../testing/index';
import type { FoldDirectory, FoldSummary } from '../../sharing/ports/index';
import type {
  AccountSecrets, CredentialStorePort, DeviceCredentials, EnrolCryptoHandle, EnrolCryptoPort, FoldGrantPort, KdfOffer, NewDeviceMaterial, RelayAuthPort, RelayErrorKind, RelayLink, RelayReply, Secret,
} from '../ports/index';
import { createSession } from './lock';
import { signInOnNewDevice, type SignInInput } from './sign-in';

const secret = (fill = 1): Secret => {
  let bytes: Uint8Array | null = new Uint8Array(32).fill(fill);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const textSecret = (text: string): Secret => {
  let bytes: Uint8Array | null = new TextEncoder().encode(text);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const GOOD: KdfOffer = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16) };
const FOLD_A = id(0xa1);
const FOLD_B = id(0xb1);
const bytesOf = (i: Id) => Uint8Array.from({ length: 16 }, (_, k) => parseInt(i.replaceAll('-', '').slice(k * 2, k * 2 + 2), 16));

interface Opts {
  offer?: KdfOffer;
  signIn?: { ok: false; kind: RelayErrorKind };
  keysetReply?: RelayReply;
  wrongSecret?: boolean;
  invalidSecretKey?: boolean;
  deviceReply?: RelayReply;
  foldsReply?: RelayReply;
  grantReply?: (fold: Id) => RelayReply;
  openable?: (fold: Id) => { epoch: number; role: 'owner' | 'editor' | 'viewer' }[];
  existing?: boolean;
}

function setup(o: Opts = {}) {
  const calls: string[] = [];
  const account: AccountSecrets = { encSk: secret(2), sigSk: secret(3), srpX: secret(4) };
  const material: NewDeviceMaterial = {
    deviceId: id(0), accountId: 'ABCDEF', deviceSigPk: new Uint8Array(32).fill(7),
    credentials: { deviceId: id(0), accountId: 'ABCDEF', sealed: new Uint8Array([1]) }, sessionKey: secret(5), deviceSigningKey: secret(6), account, publicKeys: { enc: new Uint8Array(32), sig: new Uint8Array(32) },
  };
  const srpX = secret(8);
  const derived = vi.fn(async () => srpX);
  const handle: EnrolCryptoHandle = {
    deriveSrpX: derived,
    async complete({ deviceId }) {
      calls.push('complete');
      return o.wrongSecret ? 'wrong_secret' : { ...material, deviceId, credentials: { ...material.credentials, deviceId } };
    },
    wipe: () => void calls.push('handle.wipe'),
  };
  const enrolCrypto: EnrolCryptoPort = { begin: async ({ password }) => (password.wipe(), o.invalidSecretKey ? 'invalid_secret_key' : handle) };

  const requests: string[] = [];
  let closed = false;
  const reply = (r: RelayReply | undefined, fallback: RelayReply): RelayReply => r ?? fallback;
  const link: RelayLink = {
    freshProof: new Uint8Array(32),
    close: () => void (closed = true),
    async request(method, path, body) {
      requests.push(`${method} ${path}`);
      if (path === '/accounts/me/keyset') return reply(o.keysetReply, { ok: true, status: 200, body: new Map([['keyset', new Uint8Array(100)]]) });
      if (path === '/devices') {
        const b = body as { dev_id: Uint8Array; sig_pk: Uint8Array };
        expect(b.sig_pk).toEqual(material.deviceSigPk);
        expect(b.dev_id).toHaveLength(16);
        return reply(o.deviceReply, { ok: true, status: 201, body: null });
      }
      if (path === '/folds') return reply(o.foldsReply, { ok: true, status: 200, body: [new Map<string, unknown>([['fold', bytesOf(FOLD_A)], ['head_seq', 3n]]), new Map<string, unknown>([['fold', bytesOf(FOLD_B)], ['head_seq', 0n]])] });
      const m = /^\/folds\/([A-Za-z0-9_-]+)\/grants\?member=me$/.exec(path);
      if (m) {
        const fold = [FOLD_A, FOLD_B].find((f) => path.includes(Buffer.from(bytesOf(f)).toString('base64url')))!;
        return o.grantReply ? o.grantReply(fold) : { ok: true, status: 200, body: [new Uint8Array([1, 2, 3])] };
      }
      return { ok: false, kind: 'not_found' };
    },
  };
  const relay: RelayAuthPort = {
    async signIn({ deriveX }) {
      calls.push('signIn');
      if (o.signIn) return o.signIn;
      await deriveX({ authSalt: new Uint8Array(16), kdf: o.offer ?? GOOD }); // may throw: the use case handles it
      return { ok: true, accountId: 'ABCDEF', link };
    },
  };

  const folds = new Map<Id, FoldSummary>();
  const directory: FoldDirectory = { list: async () => [...folds.values()], get: async (f) => folds.get(f), add: async (f) => void folds.set(f.id, f), rename: async () => undefined, remove: async (f) => void folds.delete(f) };
  const imported: Array<[Id, number]> = [];
  const stopped = vi.fn();
  const sessionPort = {
    async start() {
      calls.push('session.start');
      return {
        directory, commandBus: undefined as never, foldKeys: { createFoldKey: async () => 1, dropFoldKeys: async () => undefined },
        keyImport: { importFoldKey: async (f: Id, e: number) => { if (!folds.has(f)) throw new Error('key stored before its Fold'); imported.push([f, e]); }, epochs: async () => [] },
      };
    },
    stop: async () => void stopped(),
  };
  const grants: FoldGrantPort = {
    grantsFor: async () => [],
    open: async ({ fold }) => (o.openable ?? (() => [{ epoch: 1, role: 'owner' as const }]))(fold).map((g) => ({ ...g, key: secret(9) })),
  };
  let stored: DeviceCredentials | undefined = o.existing ? { deviceId: id(1), accountId: 'X', email: 'x@y.zz', server: 'https://x', registration: 'done', sealed: new Uint8Array() } : undefined;
  const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
  const session = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => 0 });
  let n = 0;
  const run = signInOnNewDevice({ relay, enrolCrypto, grants, credentials, sessionPort, session, random: { bytes: (len) => Uint8Array.from({ length: len }, (_, i) => (++n + i) & 255) } });
  const input = (over: Partial<SignInInput> = {}): SignInInput => ({ email: 'Alice@Example.com', server: 'https://relay.example.com', secretKeyText: 'C1-AAAAAA-AAAAAAAAAAA-AAAAA-AAAAA-AAAAA', password: textSecret('correct horse'), ...over });
  return { run, input, calls, requests, folds, imported, stopped, getStored: () => stored, derived, srpX, closed: () => closed, material, account, session };
}

describe('signInOnNewDevice (US4, FR-004)', () => {
  it('signs in, registers this device, opens the Fold keys and records the Folds', async () => {
    const s = setup();
    const password = textSecret('correct horse');
    const r = await s.run(s.input({ password }));
    expect(r).toMatchObject({ ok: true, value: { accountId: 'ABCDEF' } });
    expect(r.ok && r.value.folds.map((f) => f.id)).toEqual([FOLD_A, FOLD_B]);
    expect(s.requests).toEqual([
      'GET /accounts/me/keyset', 'POST /devices', 'GET /folds',
      `GET /folds/${Buffer.from(bytesOf(FOLD_A)).toString('base64url')}/grants?member=me`, `GET /folds/${Buffer.from(bytesOf(FOLD_B)).toString('base64url')}/grants?member=me`,
    ]);
    expect(s.imported).toEqual([[FOLD_A, 1], [FOLD_B, 1]]);
    expect(s.folds.size).toBe(2);
    expect(s.getStored()).toMatchObject({ accountId: 'ABCDEF', email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' });
    expect(s.closed()).toBe(true);
    expect(s.calls).toContain('handle.wipe');
    expect(password.isWiped).toBe(true);
  });

  it('stops before using the password when the service offers weaker key derivation than the floors', async () => {
    for (const offer of [{ ...GOOD, mKib: 1024 }, { ...GOOD, t: 1 }, { kdf: 'pbkdf2-hmac-sha256', iterations: 1000, encSalt: new Uint8Array(16) } as KdfOffer]) {
      const s = setup({ offer });
      const r = await s.run(s.input());
      expect(r).toMatchObject({ ok: false, error: { code: 'kdf_below_floor' } });
      expect(s.derived).not.toHaveBeenCalled();
      expect(s.getStored()).toBeUndefined();
      expect(s.requests).toEqual([]);
    }
  });

  it.each([
    ['offline', 'offline'], ['rate_limited', 'rate_limited'], ['rejected', 'wrong_credentials'], ['protocol', 'service_error'], ['kdf_below_floor', 'kdf_below_floor'],
  ] as const)('maps a %s sign-in to %s and leaves nothing behind', async (kind, code) => {
    const s = setup({ signIn: { ok: false, kind } });
    const r = await s.run(s.input());
    expect(r).toMatchObject({ ok: false, error: { code } });
    expect(s.getStored()).toBeUndefined();
    expect(s.folds.size).toBe(0);
  });

  it('gives one answer for a wrong Secret Key as for a wrong password, and keeps nothing', async () => {
    const s = setup({ wrongSecret: true });
    const r = await s.run(s.input());
    expect(r).toMatchObject({ ok: false, error: { code: 'wrong_credentials' } });
    expect(s.getStored()).toBeUndefined();
    expect(s.calls).not.toContain('session.start');
    expect(s.closed()).toBe(true);
  });

  it('refuses a malformed Secret Key before contacting the service', async () => {
    const s = setup({ invalidSecretKey: true });
    const r = await s.run(s.input());
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_secret_key' } });
    expect(s.calls).not.toContain('signIn');
  });

  it('refuses a bad email or address, wiping the password, and an already-set-up device', async () => {
    const s = setup();
    const p1 = textSecret('pw');
    expect(await s.run(s.input({ email: 'nope', password: p1 }))).toMatchObject({ ok: false, error: { code: 'invalid_email' } });
    expect(p1.isWiped).toBe(true);
    const p2 = textSecret('pw');
    expect(await s.run(s.input({ server: 'ftp://x', password: p2 }))).toMatchObject({ ok: false, error: { code: 'invalid_server' } });
    expect(p2.isWiped).toBe(true);
    const e = setup({ existing: true });
    const p3 = textSecret('pw');
    expect(await e.run(e.input({ password: p3 }))).toMatchObject({ ok: false, error: { code: 'already_has_account' } });
    expect(p3.isWiped).toBe(true);
  });

  it('accepts a device that is already registered (a retried enrolment) but not other refusals', async () => {
    const dup = setup({ deviceReply: { ok: false, kind: 'conflict' } });
    expect((await dup.run(dup.input())).ok).toBe(true);
    const bad = setup({ deviceReply: { ok: false, kind: 'forbidden' } });
    expect(await bad.run(bad.input())).toMatchObject({ ok: false });
    expect(bad.getStored()).toBeUndefined();
  });

  it('skips a Fold none of whose grants verify, and keeps the rest', async () => {
    const s = setup({ openable: (f) => (f === FOLD_A ? [] : [{ epoch: 2, role: 'editor' }, { epoch: 1, role: 'editor' }]) });
    const r = await s.run(s.input());
    expect(r.ok && r.value.folds).toMatchObject([{ id: FOLD_B, epoch: 2, role: 'editor' }]);
    expect(s.imported).toEqual([[FOLD_B, 2], [FOLD_B, 1]]);
  });

  it('rolls everything back when the Folds cannot be fetched', async () => {
    const s = setup({ foldsReply: { ok: false, kind: 'offline' } });
    const r = await s.run(s.input());
    expect(r).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(s.getStored()).toBeUndefined();
    expect(s.stopped).toHaveBeenCalled();
    expect(s.closed()).toBe(true);
  });

  it('rolls back when a grant request fails midway', async () => {
    const s = setup({ grantReply: (f) => (f === FOLD_B ? { ok: false, kind: 'forbidden' } : { ok: true, status: 200, body: [new Uint8Array([1])] }) });
    expect(await s.run(s.input())).toMatchObject({ ok: false });
    expect(s.getStored()).toBeUndefined();
  });

  it('wipes the key material it was given when sign-in fails, and keeps it for the session when it succeeds', async () => {
    const failed = setup({ foldsReply: { ok: false, kind: 'offline' } });
    await failed.run(failed.input());
    expect([failed.account.encSk, failed.account.sigSk, failed.account.srpX]).toSatisfy((all: Secret[]) => all.every((x) => x.isWiped));
    expect(failed.material.sessionKey.isWiped).toBe(true);

    const ok = setup();
    await ok.run(ok.input());
    expect(ok.account.encSk.isWiped).toBe(false);
    expect(ok.material.deviceSigningKey.isWiped).toBe(false);
  });
});
