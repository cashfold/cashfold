import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { id } from '../../testing/index';
import type { CredentialStorePort, DeviceCredentials, KdfOffer, MigrationCryptoPort, RegistrationPayload, RegistrationPort, RegistrationResult, RelayAuthPort, RelayErrorKind, RelayLink, RelayReply, Secret } from '../ports/index';
import { migrateToServer, type MigrationFolds } from './migrate-server';

const textSecret = (text: string): Secret => {
  let bytes: Uint8Array | null = new TextEncoder().encode(text);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
const GOOD: KdfOffer = { kdf: 'argon2id', mKib: 65_536, t: 3, p: 1, encSalt: new Uint8Array(16) };
const OLD = 'https://old.example';
const NEW = 'https://new.example';
const KEYSET = new Uint8Array([4, 2]);

interface Opts {
  wrong?: boolean; signInFails?: Record<string, RelayErrorKind>; register?: RegistrationResult; announceFails?: boolean; transfer?: 'ok' | 'offline' | 'failed'; sharedFolds?: Id[]; emailTakenButOurs?: boolean; del?: RelayReply;
  folds?: Id[]; registration?: 'pending' | 'done'; server?: string; keyset?: RelayReply;
}

function setup(o: Opts = {}) {
  const events: string[] = [];
  const crypto: MigrationCryptoPort = {
    async begin({ password }) {
      password.wipe();
      if (o.wrong) return 'wrong_password';
      return {
        srpX: async () => textSecret('x'),
        registration: async ({ keySet, email, server, discoverable }): Promise<RegistrationPayload> => ({ accountId: 'ABCDEF', email, discoverable, server, deviceId: id(1), keySet, deviceSigPk: new Uint8Array(32), authSalt: new Uint8Array(16), srpVerifier: new Uint8Array(512) }),
        wipe: () => void events.push('handle.wipe'),
      };
    },
  };
  const linkFor = (server: string): RelayLink => ({
    freshProof: new Uint8Array(32).fill(1), close: () => void events.push(`close ${server}`),
    async request(method, path) {
      events.push(`${server} ${method} ${path}`);
      if (path === '/accounts/me/keyset') return o.keyset ?? { ok: true, status: 200, body: new Map([['keyset', KEYSET]]) };
      if (path === '/accounts/me' && method === 'GET') return { ok: true, status: 200, body: new Map([['discoverable', false]]) };
      return o.del ?? { ok: true, status: 204, body: null };
    },
  });
  const relay: RelayAuthPort = {
    async signIn({ server, deriveX }) {
      const fail = o.signInFails?.[server] ?? (server === NEW && o.register?.ok === false && o.register.reason === 'email_taken' && !o.emailTakenButOurs ? 'rejected' : undefined);
      if (fail) return { ok: false, kind: fail };
      await deriveX({ authSalt: new Uint8Array(16), kdf: GOOD });
      return { ok: true, accountId: 'ABCDEF', link: linkFor(server) };
    },
  };
  const registered: Array<{ payload: RegistrationPayload; invite?: string }> = [];
  const registration: RegistrationPort = {
    async register(payload, options) {
      registered.push({ payload, ...(options?.inviteCode !== undefined && { invite: options.inviteCode }) });
      return o.register ?? { ok: true };
    },
  };
  let stored: DeviceCredentials | undefined = { deviceId: id(1), accountId: 'ABCDEF', email: 'a@b.cc', server: o.server ?? OLD, registration: o.registration ?? 'done', sealed: new Uint8Array([1]) };
  const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
  const folds: MigrationFolds = {
    list: async () => o.folds ?? [id(10), id(11)],
    announce: async (f, s) => (events.push(`announce ${f} ${s}`), !o.announceFails),
    async transfer(f, to) {
      events.push(`transfer ${f}`);
      await to.request('POST', '/folds');
      return o.sharedFolds?.includes(f) ? 'shared' : (o.transfer ?? 'ok');
    },
  };
  const run = migrateToServer({ crypto, relay, registration, credentials, folds });
  return { run, events, registered, stored: () => stored };
}

describe('migrateToServer (FR-100)', () => {
  it('registers the same key set on the new service, announces and copies every Fold, switches the device and deletes the old copy', async () => {
    const s = setup();
    const pw = textSecret('correct horse');
    expect(await s.run({ password: pw, server: 'https://NEW.example/' })).toEqual({ ok: true, value: { server: NEW, folds: 2, kept: [], oldDeleted: true } });
    expect(s.registered).toHaveLength(1);
    expect(s.registered[0]!.payload).toMatchObject({ keySet: KEYSET, server: NEW, discoverable: false, email: 'a@b.cc' });
    expect(s.stored()!.server).toBe(NEW);
    expect(pw.isWiped).toBe(true);
    const order = s.events.filter((e) => /announce|transfer|DELETE/.test(e));
    expect(order).toEqual([`transfer ${id(10)}`, `announce ${id(10)} ${NEW}`, `transfer ${id(11)}`, `announce ${id(11)} ${NEW}`, `${OLD} DELETE /accounts/me`]);
    expect(s.events.slice(-3).sort()).toEqual(['close https://new.example', 'close https://old.example', 'handle.wipe'].sort());
  });

  it('keeps the old copy when asked to, and says so when the old service would not delete it', async () => {
    expect(await setup().run({ password: textSecret('x'), server: NEW, deleteOld: false })).toMatchObject({ ok: true, value: { oldDeleted: false } });
    const blocked = setup({ del: { ok: false, kind: 'conflict' } });
    expect(await blocked.run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: true, value: { oldDeleted: false } });
    expect(blocked.stored()!.server).toBe(NEW); // the move still happened
  });

  it('leaves shared Folds where they are, says which, announces only what moved, and keeps the old account while any remain', async () => {
    const s = setup({ sharedFolds: [id(11)] });
    expect(await s.run({ password: textSecret('x'), server: NEW })).toEqual({ ok: true, value: { server: NEW, folds: 1, kept: [id(11)], oldDeleted: false } });
    expect(s.events.filter((e) => e.startsWith('announce'))).toEqual([`announce ${id(10)} ${NEW}`]);
    expect(s.events.some((e) => e.includes('DELETE'))).toBe(false);
    expect(s.stored()!.server).toBe(NEW);
  });

  it('carries on a move that stopped half-way: the same credentials already sign in at the new service', async () => {
    const s = setup({ register: { ok: false, reason: 'email_taken' }, emailTakenButOurs: true });
    expect(await s.run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: true, value: { folds: 2, oldDeleted: true } });
    expect(s.stored()!.server).toBe(NEW);
  });

  it('passes an invitation code to the new service', async () => {
    const s = setup();
    await s.run({ password: textSecret('x'), server: NEW, inviteCode: 'let-me-in' });
    expect(s.registered[0]!.invite).toBe('let-me-in');
  });

  it('changes nothing and deletes nothing when the new service refuses the account', async () => {
    for (const [register, code] of [[{ ok: false, reason: 'email_taken' }, 'email_taken'], [{ ok: false, reason: 'invite_required' }, 'invite_required'], [{ ok: false, reason: 'rejected' }, 'registration_rejected'], [{ ok: false, reason: 'offline' }, 'offline']] as const) {
      const s = setup({ register });
      expect(await s.run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code } });
      expect(s.stored()!.server).toBe(OLD);
      expect(s.events.some((e) => e.includes('DELETE'))).toBe(false);
    }
  });

  it('stops without deleting or switching when a Fold cannot be recorded or copied', async () => {
    for (const opts of [{ announceFails: true }, { transfer: 'failed' }, { transfer: 'offline' }] as const) {
      const s = setup(opts);
      expect((await s.run({ password: textSecret('x'), server: NEW })).ok).toBe(false);
      expect(s.stored()!.server).toBe(OLD);
      expect(s.events.some((e) => e.includes('DELETE'))).toBe(false);
    }
  });

  it('refuses a wrong password, the same service, an unregistered account and a bad address before contacting anyone', async () => {
    const wrong = setup({ wrong: true });
    expect(await wrong.run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code: 'wrong_password' } });
    expect(await setup().run({ password: textSecret('x'), server: OLD })).toMatchObject({ ok: false, error: { code: 'same_server' } });
    expect(await setup({ registration: 'pending' }).run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code: 'not_registered' } });
    const bad = setup();
    expect(await bad.run({ password: textSecret('x'), server: 'not a url' })).toMatchObject({ ok: false, error: { code: 'invalid_server' } });
    for (const s of [wrong, bad]) expect(s.events.filter((e) => e.includes('GET'))).toEqual([]);
  });

  it('reports the old or new service being unreachable or rejecting the credentials', async () => {
    expect(await setup({ signInFails: { [OLD]: 'offline' } }).run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(await setup({ signInFails: { [OLD]: 'rejected' } }).run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code: 'wrong_credentials' } });
    const second = setup({ signInFails: { [NEW]: 'rejected' } });
    expect(await second.run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code: 'wrong_credentials' } });
    expect(second.stored()!.server).toBe(OLD);
    expect(await setup({ keyset: { ok: true, status: 200, body: new Map() } }).run({ password: textSecret('x'), server: NEW })).toMatchObject({ ok: false, error: { code: 'service_error' } });
  });
});
