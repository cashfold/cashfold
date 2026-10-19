import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { id } from '../../testing/index';
import type { CredentialChangeCryptoPort, CredentialStorePort, DeviceCredentials, KdfOffer, RelayAuthPort, RelayErrorKind, RelayLink, RelayReply, Secret } from '../ports/index';
import { deleteAccount, wipeAfterGone, type DeletableFold } from './delete-account';

const textSecret = (text: string): Secret => {
  let bytes: Uint8Array | null = new TextEncoder().encode(text);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const GOOD: KdfOffer = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16) };
const PROOF = new Uint8Array(32).fill(6);
const fold = (n: number, role: DeletableFold['role'], shared: boolean): DeletableFold => ({ id: id(n), name: `Fold ${n}`, role, shared });

interface Opts { folds?: DeletableFold[]; wrong?: boolean; signIn?: RelayErrorKind; del?: RelayReply; offer?: KdfOffer; leaveFails?: Id; registration?: 'pending' | 'done'; noAccount?: boolean }

function setup(o: Opts = {}) {
  const log: string[] = [];
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const crypto: CredentialChangeCryptoPort = {
    async begin({ password }) {
      password.wipe();
      return o.wrong ? 'wrong_password' : { currentSrpX: async () => textSecret('x'), prepare: async () => { throw new Error('not used'); }, wipe: () => void log.push('handle.wipe') };
    },
  };
  const link: RelayLink = {
    freshProof: PROOF, close: () => void log.push('link.close'),
    async request(method, path, body) { requests.push({ method, path, body }); return o.del ?? { ok: true, status: 204, body: null }; },
  };
  const relay: RelayAuthPort = {
    async signIn({ deriveX }) {
      if (o.signIn) return { ok: false, kind: o.signIn };
      await deriveX({ authSalt: new Uint8Array(16), kdf: o.offer ?? GOOD });
      return { ok: true, accountId: 'ABCDEF', link };
    },
  };
  const stored: DeviceCredentials | undefined = o.noAccount ? undefined : { deviceId: id(1), accountId: 'ABCDEF', email: 'a@b.cc', server: 'https://relay.example', registration: o.registration ?? 'done', sealed: new Uint8Array([1]) };
  const credentials: CredentialStorePort = { save: async () => undefined, load: async () => stored, clear: async () => undefined };
  const left: Id[] = [];
  const erased = { count: 0 };
  const run = deleteAccount({
    crypto, relay, credentials,
    folds: { list: async () => o.folds ?? [fold(10, 'owner', false)], leave: async (f) => (f === o.leaveFails ? false : (left.push(f), true)) },
    eraseLocal: async () => void erased.count++,
  });
  return { run, requests, log, left, erased };
}

describe('deleteAccount (FR-101)', () => {
  it('proves the password anew, deletes at the service with the fresh proof, then erases this device', async () => {
    const s = setup();
    const pw = textSecret('correct horse');
    expect(await s.run({ password: pw })).toEqual({ ok: true, value: true });
    expect(s.requests).toEqual([{ method: 'DELETE', path: '/accounts/me', body: { fresh_proof: PROOF, removal_entries: [] } }]);
    expect(s.erased.count).toBe(1);
    expect(pw.isWiped).toBe(true);
    expect(s.log).toEqual(['link.close', 'handle.wipe']);
  });

  it('is blocked while this account owns a Fold others share, naming each, and contacts nothing', async () => {
    const s = setup({ folds: [fold(10, 'owner', true), fold(11, 'owner', false), fold(12, 'owner', true)] });
    const r = await s.run({ password: textSecret('correct horse') });
    expect(r).toMatchObject({ ok: false, error: { code: 'owns_shared_fold', folds: [{ id: id(10), name: 'Fold 10' }, { id: id(12), name: 'Fold 12' }] } });
    expect(s.requests).toEqual([]);
    expect(s.erased.count).toBe(0);
  });

  it('leaves Folds shared with it before deleting, and does not delete if one cannot be left', async () => {
    const folds = [fold(10, 'editor', true), fold(11, 'viewer', true), fold(12, 'owner', false)];
    const ok = setup({ folds });
    await ok.run({ password: textSecret('correct horse') });
    expect(ok.left).toEqual([id(10), id(11)]);
    const stuck = setup({ folds, leaveFails: id(11) });
    expect(await stuck.run({ password: textSecret('correct horse') })).toMatchObject({ ok: false, error: { code: 'could_not_leave' } });
    expect(stuck.requests).toEqual([]);
    expect(stuck.erased.count).toBe(0);
  });

  it('refuses a wrong password before anything else happens', async () => {
    const s = setup({ wrong: true });
    expect(await s.run({ password: textSecret('nope nope nope') })).toMatchObject({ ok: false, error: { code: 'wrong_password' } });
    expect(s.requests).toEqual([]);
    expect(s.erased.count).toBe(0);
  });

  it('keeps everything when the service cannot be reached or refuses', async () => {
    for (const [opts, code] of [[{ signIn: 'offline' }, 'offline'], [{ signIn: 'rejected' }, 'wrong_credentials'], [{ del: { ok: false, kind: 'offline' } }, 'offline'], [{ del: { ok: false, kind: 'conflict' } }, 'owns_shared_fold']] as const) {
      const s = setup(opts as Opts);
      expect(await s.run({ password: textSecret('correct horse') })).toMatchObject({ ok: false, error: { code } });
      expect(s.erased.count).toBe(0);
    }
  });

  it('treats an account that is already gone as deleted and erases this device', async () => {
    for (const opts of [{ signIn: 'gone' }, { del: { ok: false, kind: 'gone' } }] as const) {
      const s = setup(opts as Opts);
      expect(await s.run({ password: textSecret('correct horse') })).toEqual({ ok: true, value: true });
      expect(s.erased.count).toBe(1);
    }
  });

  it('refuses weak service settings, an unregistered account and no account', async () => {
    const weak = setup({ offer: { kdf: 'argon2id', mKib: 1024, t: 1, p: 1, encSalt: new Uint8Array(16) } });
    expect(await weak.run({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'kdf_below_floor' } });
    expect(await setup({ registration: 'pending' }).run({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'not_registered' } });
    expect(await setup({ noAccount: true }).run({ password: textSecret('x') })).toMatchObject({ ok: false, error: { code: 'no_account' } });
  });

  it('erases this device when another one reports the account gone (410)', async () => {
    let n = 0;
    await wipeAfterGone({ eraseLocal: async () => void n++ });
    expect(n).toBe(1);
  });
});
