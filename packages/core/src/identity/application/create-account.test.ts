import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogEntry } from '../../shared-kernel/logger';
import type { Id } from '../../shared-kernel/id';
import { createCommandBus, createEventBus } from '../../sync/application/buses';
import { createReplica, createWorld, id } from '../../testing/index';
import type { FoldDirectory, FoldKeyPort, FoldSummary } from '../../sharing/ports/index';
import { roleResolver } from '../../sharing/application/fold-commands';
import type { AccountCryptoPort, CredentialStorePort, DeviceCredentials, RegistrationPayload, RegistrationPort, RegistrationResult, Secret, SessionPort } from '../ports/index';
import { createAccount } from './create-account';
import { createSession } from './lock';

const secret = (fill = 1): Secret => {
  let bytes: Uint8Array | null = new Uint8Array(32).fill(fill);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
};
// A password secret that decodes to exactly `text`.
function passwordOf(text: string): Secret {
  let bytes: Uint8Array | null = new TextEncoder().encode(text);
  return { get length() { return bytes?.length ?? 0; }, get isWiped() { return bytes === null; }, use: (fn) => fn(bytes!), wipe: () => { bytes?.fill(0); bytes = null; } };
}

const SECRET_KEY_TEXT = 'C1-XRG88A-AEBAGBAFA2D-SSCJL-BNGA4-DSRCA';
const GOOD_PASSWORD = 'correct horse battery staple';

async function setup(opts: { registration?: RegistrationResult; cryptoFails?: boolean; foldFails?: boolean } = {}) {
  const world = await createWorld();
  const replica = await createReplica(world, { device: id(0xd1) });
  const folds = new Map<Id, FoldSummary>();
  const directory: FoldDirectory = {
    list: async () => [...folds.values()], get: async (f) => folds.get(f), add: async (f) => void folds.set(f.id, f),
    rename: async () => undefined, remove: async (f) => void folds.delete(f),
  };
  const dropped: Id[] = [];
  const foldKeys: FoldKeyPort = {
    async createFoldKey(fold) { if (opts.foldFails) throw new Error('keystore broken'); world.addFold(fold); return 1; },
    async dropFoldKeys(fold) { dropped.push(fold); },
  };
  const sessionKey = secret(9);
  const consumed: Secret[] = [];
  const crypto: AccountCryptoPort = {
    async createAccount({ password }) {
      consumed.push(password);
      try {
        if (opts.cryptoFails) throw new Error('argon2 failed');
        return {
          accountId: 'XRG88A', secretKeyText: SECRET_KEY_TEXT, deviceId: id(0xd1),
          registration: { accountId: 'XRG88A', deviceId: id(0xd1), keySet: new Uint8Array([1, 2, 3]), deviceSigPk: new Uint8Array(32) },
          credentials: { deviceId: id(0xd1), accountId: 'XRG88A', sealed: new Uint8Array([9, 9]) },
          sessionKey, deviceSigningKey: secret(5),
        };
      } finally {
        password.wipe();
      }
    },
  };
  const registered: RegistrationPayload[] = [];
  const registration: RegistrationPort = { async register(p) { registered.push(p); return opts.registration ?? { ok: true }; } };
  let stored: DeviceCredentials | undefined;
  const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
  const stopped = vi.fn();
  const sessionPort: SessionPort = {
    async start() {
      return {
        directory, foldKeys,
        commandBus: createCommandBus({ writePath: replica.writePath, projections: replica.projections, events: createEventBus(), roleOf: roleResolver(directory), isUnlocked: () => true }),
      };
    },
    stop: async () => void stopped(),
  };
  const now = 1_000;
  const session = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => now });
  const entries: LogEntry[] = [];
  const logger = createLogger({ sink: (e) => void entries.push(e) });
  let counter = 0;
  const random = { bytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (++counter + i) & 0xff) };
  const runWith = createAccount({ crypto, registration, credentials, sessionPort, session, random, logger });
  const run = (input: Partial<{ email: string; password: string; server: string; discoverable: boolean }> = {}) =>
    runWith({
      email: input.email ?? 'Alice@Example.com', password: passwordOf(input.password ?? GOOD_PASSWORD), server: input.server ?? 'https://relay.example.com', discoverable: input.discoverable ?? true,
    });
  return { run, runWith, folds, dropped, sessionKey, consumed, registered, getStored: () => stored, stopped, session, entries, replica };
}

describe('createAccount (US1: sign up offline, get a Secret Key and a first Fold)', () => {
  it('creates the account, shows the Secret Key once, stores credentials and makes a Personal Fold', async () => {
    const s = await setup();
    const r = await s.run();
    expect(r).toMatchObject({ ok: true, value: { secretKeyText: SECRET_KEY_TEXT, accountId: 'XRG88A', account: { state: 'active', email: 'alice@example.com', discoverable: true, server: 'https://relay.example.com' }, registration: 'done' } });
    if (!r.ok) return;
    expect(r.value.fold).toMatchObject({ name: 'Personal', baseCurrency: 'USD', role: 'owner', epoch: 1 });
    expect(s.folds.size).toBe(1);
    expect(s.getStored()).toMatchObject({ accountId: 'XRG88A', email: 'alice@example.com', server: 'https://relay.example.com', registration: 'done' });
    expect(s.registered[0]).toMatchObject({ accountId: 'XRG88A', email: 'alice@example.com', discoverable: true, server: 'https://relay.example.com' });
  });

  it('works offline: registration is queued and the account stays a draft until the service is reached', async () => {
    const s = await setup({ registration: { ok: false, reason: 'offline' } });
    const r = await s.run();
    expect(r).toMatchObject({ ok: true, value: { registration: 'pending', account: { state: 'draft' } } });
    expect(s.getStored()?.registration).toBe('pending');
    expect(s.folds.size).toBe(1);
  });

  it('honours the chosen base currency and Fold name', async () => {
    const s = await setup();
    const r = await createAccountWith(s, { baseCurrency: 'EUR', foldName: 'Mein Geld' });
    expect(r).toMatchObject({ ok: true, value: { fold: { name: 'Mein Geld', baseCurrency: 'EUR' } } });
  });

  it('rejects a malformed email and creates nothing, wiping the password', async () => {
    const s = await setup();
    const password = passwordOf(GOOD_PASSWORD);
    const r = await createAccountWithPassword(s, password, { email: 'not-an-email' });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_email' }) });
    expect(password.isWiped).toBe(true);
    expect(s.getStored()).toBeUndefined();
    expect(s.folds.size).toBe(0);
  });

  it('rejects a weak password with the reasons, without calling the crypto port', async () => {
    const s = await setup();
    const r = await s.run({ password: 'password1234' });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'weak_password', violations: ['too_common'] }) });
    expect(s.consumed).toHaveLength(0);
    const short = await s.run({ password: 'Short1!' });
    expect(short).toEqual({ ok: false, error: expect.objectContaining({ code: 'weak_password', violations: ['too_short'] }) });
  });

  it('wipes the password even when the policy check fails', async () => {
    const s = await setup();
    const password = passwordOf('short');
    await createAccountWithPassword(s, password, {});
    expect(password.isWiped).toBe(true);
  });

  it('rejects an invalid service address', async () => {
    const s = await setup();
    expect(await s.run({ server: 'http://relay.example.com' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_server' }) });
  });

  it('rolls everything back when the service says the email is taken', async () => {
    const s = await setup({ registration: { ok: false, reason: 'email_taken' } });
    const r = await s.run();
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'email_taken' }) });
    expect(s.getStored()).toBeUndefined();
    expect(s.folds.size).toBe(0);
    expect(s.stopped).toHaveBeenCalled();
    expect(s.sessionKey.isWiped).toBe(true);
  });

  it('rolls back when the first Fold cannot be created', async () => {
    const s = await setup({ foldFails: true });
    await expect(s.run()).rejects.toThrow('keystore broken');
    expect(s.getStored()).toBeUndefined();
    expect(s.stopped).toHaveBeenCalled();
    expect(s.sessionKey.isWiped).toBe(true);
  });

  it('leaves nothing behind when key derivation fails, and the password is gone', async () => {
    const s = await setup({ cryptoFails: true });
    await expect(s.run()).rejects.toThrow('argon2 failed');
    expect(s.consumed[0]!.isWiped).toBe(true);
    expect(s.getStored()).toBeUndefined();
    expect(s.folds.size).toBe(0);
  });

  it('puts the session key under the lock controller, so locking wipes it', async () => {
    const s = await setup();
    await s.run();
    expect(s.sessionKey.isWiped).toBe(false);
    await s.session.lock();
    expect(s.sessionKey.isWiped).toBe(true);
  });

  it('never logs the Secret Key, the password or the email', async () => {
    const s = await setup();
    await s.run({ email: 'private.person@example.com', password: 'Tr0ub4dor&3-xylophone-gamma' });
    const out = JSON.stringify(s.entries);
    expect(s.entries.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/XRG88A-|AEBAGBAFA2D|Tr0ub4dor|private\.person/);
  });
});

describe('other refusals', () => {
  it('rolls back when the service rejects the registration for another reason', async () => {
    const s = await setup({ registration: { ok: false, reason: 'rejected' } });
    expect(await s.run()).toEqual({ ok: false, error: expect.objectContaining({ code: 'registration_rejected' }) });
    expect(s.getStored()).toBeUndefined();
    expect(s.folds.size).toBe(0);
    expect(s.sessionKey.isWiped).toBe(true);
  });

  it('reports an invalid Fold name or base currency and rolls back', async () => {
    const s = await setup();
    expect(await s.runWith({ email: 'a@example.com', password: passwordOf(GOOD_PASSWORD), server: 'https://relay.example.com', discoverable: true, foldName: '   ' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_fold_name' }) });
    expect(await s.runWith({ email: 'a@example.com', password: passwordOf(GOOD_PASSWORD), server: 'https://relay.example.com', discoverable: true, baseCurrency: 'XXX' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'unknown_currency' }) });
    expect(s.getStored()).toBeUndefined();
    expect(s.folds.size).toBe(0);
  });

  it('works without a logger', async () => {
    const s = await setup();
    expect((await s.runWith({ email: 'a@example.com', password: passwordOf(GOOD_PASSWORD), server: 'https://relay.example.com', discoverable: false })).ok).toBe(true);
  });
});

// Helpers that pass richer input than the shorthand `run`.
type Setup = Awaited<ReturnType<typeof setup>>;
async function createAccountWith(s: Setup, extra: { baseCurrency?: string; foldName?: string }) {
  return s.runWith({ email: 'a@example.com', password: passwordOf(GOOD_PASSWORD), server: 'https://relay.example.com', discoverable: true, ...extra });
}
async function createAccountWithPassword(s: Setup, password: Secret, over: { email?: string }) {
  return s.runWith({ email: over.email ?? 'a@example.com', password, server: 'https://relay.example.com', discoverable: true });
}
