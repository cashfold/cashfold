// Scenarios that run inside a dedicated worker (OPFS access handles only exist there) and return plain data
// for the browser test to assert on. Test support only: never imported by application code.
import { idToBytes, type Id } from '@cashfold/core';
import { storeContract } from '@cashfold/core/testing';
import { SecretBuf } from '@cashfold/crypto';
import { EncryptedDatabase } from './database';
import { migrate, MigrationError } from './migrate';
import type { Migration } from './migrations/generated';
import type { Bind } from './database';
import { loadRuntime, type SqliteRuntime } from './runtime';
import { createSqliteAttachmentStore } from './attachment-store';
import { openOrRecover } from './recovery';
import { decodeValue, encodeValue } from './value-codec';
import { createSqliteOpLog, createSqliteProjections } from './sqlite-stores';
import { createAccount, createSession, DEFAULT_SETTINGS, parseSettings, unlock, type CredentialStorePort, type DeviceCredentials, type RegistrationResult } from '@cashfold/core';
import { createAccountCrypto } from '../account-crypto';
import { createLocalEraser } from '../local-erase';
import { createPakeLoader } from '../transport/pake';
import { createWebSession } from './web-session';
import { createAppHandlers } from '../../worker/app-handlers';
import { createRpcServer } from '../../worker/rpc';

const key = (fill: number) => SecretBuf.from(new Uint8Array(32).fill(fill));
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

export interface ScenarioContext {
  readonly dir: string;
  readonly clear: boolean;
  /** Scenario-specific argument (the contract case index). */
  readonly arg?: number;
}

async function runtimeFor(ctx: ScenarioContext): Promise<SqliteRuntime> {
  return loadRuntime({ vfsName: `t${ctx.dir.replaceAll('/', '_')}`, directory: ctx.dir, initialCapacity: 8, clearOnInit: ctx.clear });
}

/** Opens `/test.db`, runs the callback, always closes. */
async function withDb<T>(ctx: ScenarioContext, fill: number, fn: (db: EncryptedDatabase, rt: SqliteRuntime) => Promise<T> | T): Promise<T> {
  const rt = await runtimeFor(ctx);
  const db = EncryptedDatabase.open(rt, '/test.db', key(fill));
  try {
    return await fn(db, rt);
  } finally {
    db.close();
  }
}

async function throws(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return 'no error';
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message.split('\n')[0]}`;
  }
}

async function rawEdit(rt: SqliteRuntime, dir: string, file: string, edit: (sah: FileSystemSyncAccessHandle) => void): Promise<void> {
  // The pool stores each logical file in an opaque slot: 4096-byte header (path first), payload after it.
  await rt.pool.pauseVfs();
  try {
    const root = await navigator.storage.getDirectory();
    let d = root;
    for (const part of dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part);
    d = await d.getDirectoryHandle('.opaque');
    for await (const [, handle] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const sah = await (handle as FileSystemFileHandle).createSyncAccessHandle();
      try {
        const head = new Uint8Array(512);
        sah.read(head, { at: 0 });
        const path = new TextDecoder().decode(head.slice(0, Math.max(0, head.indexOf(0))));
        if (path === file) edit(sah);
      } finally {
        sah.flush();
        sah.close();
      }
    }
  } finally {
    await rt.pool.unpauseVfs();
  }
}

/** What each slot file of the pool holds: its size, and whether any byte in it is not zero. */
async function slotFiles(rt: SqliteRuntime, dir: string): Promise<Array<{ size: number; nonZero: boolean }>> {
  await rt.pool.pauseVfs();
  try {
    const root = await navigator.storage.getDirectory();
    let d = root;
    for (const part of dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part);
    d = await d.getDirectoryHandle('.opaque');
    const out: Array<{ size: number; nonZero: boolean }> = [];
    for await (const [, handle] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const sah = await (handle as FileSystemFileHandle).createSyncAccessHandle();
      try {
        const bytes = new Uint8Array(sah.getSize());
        sah.read(bytes, { at: 0 });
        out.push({ size: bytes.length, nonZero: bytes.some((b) => b !== 0) });
      } finally {
        sah.close();
      }
    }
    return out;
  } finally {
    await rt.pool.unpauseVfs();
  }
}

const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const pwBuf = (text: string) => SecretBuf.from(new TextEncoder().encode(text));

export const scenarios = {
  /** The Core Worker's application handlers, driven the way the page drives them. */
  async appHandlers(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    let stored: DeviceCredentials | undefined;
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    let lockedAnnounced = 0;
    let savedSettings: unknown;
    const app = createAppHandlers({
      runtime: async () => rt, rng, credentials, nowMs: Date.now, onLocked: () => void lockedAnnounced++,
      accountCrypto: createAccountCrypto({ rng, kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } }),
      settings: { load: async () => parseSettings(savedSettings), save: async (s) => void (savedSettings = s) },
      quickStore: { load: async () => undefined, save: async () => undefined, clear: async () => undefined },
      quickCrypto: { enroll: async () => 'wrong_password', unlock: async () => 'failed' },
    });
    const server = createRpcServer(app.handlers);
    const call = (method: string, args?: unknown) => server.invoke(method, args);
    const bytes = (text: string) => new TextEncoder().encode(text);
    const out: Record<string, unknown> = {};

    out['statusFresh'] = await call('status');
    out['foldsBeforeSignUp'] = await call('folds.list').catch((e: Error) => `${e.name}:${(e as { code?: string }).code}`);
    out['weak'] = await call('createAccount', { email: 'a@example.com', password: bytes('password1234'), server: 'https://relay.example.com', discoverable: true });
    const created = (await call('createAccount', { email: 'a@example.com', password: bytes('correct horse battery staple'), server: 'https://relay.example.com', discoverable: true })) as { ok: boolean; value: { secretKeyText: string; accountId: string; fold: { id: string; name: string } } };
    out['created'] = { ok: created.ok, keyShape: /^C1-/.test(created.value.secretKeyText), fold: created.value.fold.name, leaksOtherSecrets: Object.keys(created.value).sort() };
    out['statusUnlocked'] = await call('status');

    const personal = created.value.fold.id;
    const work = (await call('folds.create', { name: 'Work', baseCurrency: 'EUR' })) as { ok: boolean; value: { id: string } };
    out['createdWork'] = work.ok;
    out['renamed'] = await call('folds.rename', { fold: work.value.id, name: 'Day job' });
    out['described'] = await call('folds.describeDeletion', { fold: work.value.id });
    out['badConfirm'] = await call('folds.delete', { fold: work.value.id, confirmName: 'work' });
    out['listBeforeDelete'] = ((await call('folds.list')) as { name: string }[]).map((f) => f.name);
    out['deleted'] = await call('folds.delete', { fold: work.value.id, confirmName: 'Day job' });
    out['lastFold'] = await call('folds.delete', { fold: personal, confirmName: 'Personal' });
    out['listAfterDelete'] = ((await call('folds.list')) as { name: string }[]).map((f) => f.name);

    out['settingsDefault'] = await call('settings.get');
    out['settingsSet'] = await call('settings.set', { autoLockMinutes: 1, hiddenGraceSeconds: 5, evil: 'x' });
    await call('settings.set', { autoLockMinutes: 5, hiddenGraceSeconds: 60 }); // back to defaults for the rest of the run
    out['kitWrong'] = await call('emergencyKit.export', { password: bytes('not the password at all') });
    const kit = (await call('emergencyKit.export', { password: bytes('correct horse battery staple') })) as { ok: boolean; value: { secretKeyText: string; accountId: string } };
    out['kitRight'] = { ok: kit.ok, sameKey: kit.value.secretKeyText === created.value.secretKeyText, accountId: kit.value.accountId === created.value.accountId };

    out['coveredWhenHidden'] = await call('session.visibility', { state: 'hidden' });
    out['coveredWhenVisible'] = await call('session.visibility', { state: 'visible' });
    await call('session.pageHide');
    await new Promise((r) => setTimeout(r, 50));
    out['afterPageHide'] = { announced: lockedAnnounced, calls: await call('folds.list').catch((e: Error) => (e as { code?: string }).code), statusAfter: await call('status') };
    return out;
  },

  /** The local eraser (spec 011): everything in the pool goes, with nothing stale left in the slots, and what belongs to the device stays. */
  async localErase(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    let stored: DeviceCredentials | undefined = { deviceId: '00000000-0000-4000-8000-000000000001' as DeviceCredentials['deviceId'], accountId: 'ABCDEF', email: 'a@example.com', server: '', registration: 'local', sealed: new Uint8Array([1, 2, 3]) };
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    let quick: unknown = { credentialId: new Uint8Array([1]) };
    const quickStore = { load: async () => quick as never, save: async () => undefined, clear: async () => void (quick = undefined) };
    let settings = { ...DEFAULT_SETTINGS, autoLockMinutes: 15, quickUnlock: { enabled: true, maxIdleMinutes: 90 }, lastBackupAtMs: 1_700_000_000_000, kitReminderDismissed: true };
    const settingsPort = { load: async () => settings, save: async (x: typeof settings) => void (settings = x) };
    const eraser = createLocalEraser({ runtime: async () => rt, credentials, quickStore, settings: settingsPort });
    const out: Record<string, unknown> = {};

    await withDb(ctx, 7, (db) => {
      db.exec('CREATE TABLE m(v BLOB NOT NULL) STRICT');
      db.run('INSERT INTO m VALUES (?)', [new TextEncoder().encode('Zebra Savings account balance')]);
    });
    out['filesBefore'] = rt.pool.getFileNames().length;
    out['slotsBefore'] = (await slotFiles(rt, ctx.dir)).filter((f) => f.nonZero).length;

    await eraser.eraseAll();
    out['filesAfter'] = rt.pool.getFileNames();
    out['slotsAfterWithContent'] = (await slotFiles(rt, ctx.dir)).filter((f) => f.size > 4096 || f.nonZero).length;
    out['credentials'] = stored;
    out['quick'] = quick;
    out['settings'] = settings;

    await eraser.eraseAll(); // safe to repeat
    out['again'] = { files: rt.pool.getFileNames(), credentials: stored };
    return out;
  },

  /**
   * A local-only account (spec 010) through the worker handlers: nothing reaches a service while it is local, it stays local across
   * lock, unlock and a restart, and connecting later registers it without losing the data.
   */
  async localOnly(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const PASSWORD = 'correct horse battery staple';
    let stored: DeviceCredentials | undefined;
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    let savedSettings: unknown;
    const calls = { signIn: 0, register: 0, rates: 0 };
    const payloads: Array<{ discoverable: boolean; server: string }> = [];
    let nextRegistration: RegistrationResult = { ok: true };
    const accountCrypto = createAccountCrypto({ rng, pake: createPakeLoader({ rng }), kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } });
    const build = () => createAppHandlers({
      runtime: async () => rt, rng, credentials, nowMs: Date.now, onLocked: () => undefined,
      accountCrypto, registerCrypto: accountCrypto,
      settings: { load: async () => parseSettings(savedSettings), save: async (x) => void (savedSettings = x) },
      quickStore: { load: async () => undefined, save: async () => undefined, clear: async () => undefined },
      quickCrypto: { enroll: async () => 'wrong_password', unlock: async () => 'failed' },
      relayAuth: { signIn: async () => (calls.signIn++, { ok: false, kind: 'offline' }) },
      registration: { register: async (payload) => (calls.register++, payloads.push({ discoverable: payload.discoverable, server: payload.server }), nextRegistration) },
      ratesSource: () => ({ fetch: async () => (calls.rates++, Promise.reject(new Error('no service'))) }),
    });
    const bytes = (text: string) => new TextEncoder().encode(text);
    type Ok<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const out: Record<string, unknown> = {};

    let app = build();
    let server = createRpcServer(app.handlers);
    let call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    const restart = async () => {
      await call('session.pageHide');
      await new Promise((r) => setTimeout(r, 50));
      app = build();
      server = createRpcServer(app.handlers);
      call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    };

    const created = await call<Ok<{ registration: string; fold: { id: string } }>>('createAccount', { email: 'a@example.com', password: bytes(PASSWORD) });
    out['created'] = created.ok ? { ok: true, registration: created.value.registration } : created;
    if (!created.ok) return out;
    const fold = created.value.fold.id;
    const acct = await call<Ok<{ id: string }>>('ledger.createAccount', { fold, kind: 'checking', name: 'Checking', currency: 'USD', openingBalanceMinor: 100_000n, openingDate: 20_260_101 });
    out['accountCreated'] = acct.ok;
    out['afterSignUp'] = { status: await call('status'), sync: await call('sync.status'), stored: { registration: stored?.registration, server: stored?.server } };

    await restart();
    out['lockedStatus'] = await call('status');
    out['unlocked'] = (await call<Ok<unknown>>('unlock', { password: bytes(PASSWORD) })).ok;
    out['afterUnlock'] = { status: await call('status'), sync: await call('sync.status') };
    await restart();
    out['unlockedAfterRestart'] = (await call<Ok<unknown>>('unlock', { password: bytes(PASSWORD) })).ok;
    out['afterRestart'] = { sync: await call('sync.status') };
    out['callsWhileLocal'] = { ...calls };

    // connecting
    out['noAddress'] = await call('sync.enable', { password: bytes(PASSWORD) });
    out['wrongPassword'] = await call('sync.enable', { password: bytes('not the password at all'), server: 'https://relay.example.com' });
    nextRegistration = { ok: false, reason: 'offline' };
    out['unreachable'] = await call('sync.enable', { password: bytes(PASSWORD), server: 'https://relay.example.com' });
    out['stillLocal'] = { registration: stored?.registration, server: stored?.server, accounts: (await call<Ok<{ accounts: unknown[] }>>('ledger.basics', { fold })).ok };
    nextRegistration = { ok: true };
    out['connected'] = await call('sync.enable', { password: bytes(PASSWORD), server: 'https://relay.example.com', discoverable: false });
    out['afterConnect'] = { status: await call('status'), sync: await call('sync.status'), stored: { registration: stored?.registration, server: stored?.server }, registered: payloads.at(-1) };
    const basics = await call<Ok<{ accounts: Array<{ name: string; balanceMinor: bigint | null }> }>>('ledger.basics', { fold });
    out['dataAfterConnect'] = basics.ok ? basics.value.accounts.map((a) => [a.name, a.balanceMinor]) : basics.error;
    await call('session.pageHide');
    return out;
  },

  /**
   * Signing out (spec 011) through the worker handlers over the real encrypted database and pool: everything goes, the lock policy stays, the whole
   * thing is quick, the lock-screen path erases without a database being open, and a sign-out that was cut short is finished by the very next call.
   */
  async signOut(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const PASSWORD = 'correct horse battery staple';
    let stored: DeviceCredentials | undefined;
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    let savedSettings: unknown;
    const settings = { load: async () => parseSettings(savedSettings), save: async (x: Parameters<typeof parseSettings>[0]) => void (savedSettings = x) };
    let quick: unknown;
    const quickStore = { load: async () => quick as never, save: async (r: unknown) => void (quick = r), clear: async () => void (quick = undefined) };
    let marked = false;
    const pendingErase = { set: async () => void (marked = true), isSet: async () => marked, clear: async () => void (marked = false) };
    const events: string[] = [];
    const calls = { signIn: 0, register: 0 };
    const accountCrypto = createAccountCrypto({ rng, pake: createPakeLoader({ rng }), kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } });
    let locked = 0;
    const build = () => createAppHandlers({
      runtime: async () => rt, rng, credentials, nowMs: Date.now, onLocked: () => void locked++,
      accountCrypto, registerCrypto: accountCrypto, settings: settings as never,
      quickStore: quickStore as never, quickCrypto: { enroll: async () => 'wrong_password', unlock: async () => 'failed' },
      relayAuth: { signIn: async () => (calls.signIn++, { ok: false, kind: 'offline' }) },
      registration: { register: async () => (calls.register++, { ok: true }) },
      pendingErase, localEraser: createLocalEraser({ runtime: async () => rt, credentials, quickStore: quickStore as never, settings: settings as never }),
      publish: (e) => void events.push(e.type),
    });
    const bytes = (text: string) => new TextEncoder().encode(text);
    type Ok<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    let app = build();
    let server = createRpcServer(app.handlers);
    let call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    const restart = async () => {
      await call('session.pageHide');
      await new Promise((r) => setTimeout(r, 50));
      app = build();
      server = createRpcServer(app.handlers);
      call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    };
    const out: Record<string, unknown> = {};
    const left = () => ({ files: rt.pool.getFileNames(), credentials: stored, quick, marked });

    // 1. an unlocked account that exists only on this device
    const created = await call<Ok<{ fold: { id: string } }>>('createAccount', { email: 'a@example.com', password: bytes(PASSWORD) });
    if (!created.ok) throw new Error('sign-up failed');
    await call('ledger.createAccount', { fold: created.value.fold.id, kind: 'checking', name: 'Zebra Savings', currency: 'USD', openingBalanceMinor: 100_000n, openingDate: 20_260_101 });
    await call('settings.set', { autoLockMinutes: 15, lastBackupAtMs: 1_700_000_000_000, kitReminderDismissed: true });
    out['before'] = { files: rt.pool.getFileNames().length, credentials: stored !== undefined };
    const started = Date.now();
    out['signedOut'] = await call('account.signOut');
    out['tookMs'] = Date.now() - started;
    await new Promise((r) => setTimeout(r, 250)); // the lock comes just after the reply
    out['afterSignOut'] = { ...left(), settings: parseSettings(savedSettings), events: [...events], lockedAnnounced: locked, siteContacted: { ...calls } };
    out['statusAfter'] = await call('status');
    out['signOutWithNoAccount'] = await call('account.signOut');

    // 2. an account that was registered with a service, which cannot be reached to remove the device
    events.length = 0;
    await restart();
    const registered = await call<Ok<{ fold: { id: string } }>>('createAccount', { email: 'b@example.com', password: bytes(PASSWORD), server: 'https://relay.example.com', discoverable: true });
    out['registeredCreated'] = registered.ok;
    // A change made while the service cannot be reached is counted at once, with no sync round having finished to count it (a sign-out relies on this).
    if (registered.ok) await call('ledger.createAccount', { fold: registered.value.fold.id, kind: 'checking', name: 'Offline', currency: 'USD', openingBalanceMinor: 0n, openingDate: 20_260_101 });
    out['pendingWhileOffline'] = ((await call<{ folds: Array<{ pendingOps: number }> }>('sync.status')).folds).map((f) => f.pendingOps);
    out['signedOutRegistered'] = await call('account.signOut');
    out['afterRegistered'] = left();

    // 3. the lock screen: a wrong address erases nothing, the right one erases with no database open
    await restart();
    await call('createAccount', { email: 'c@example.com', password: bytes(PASSWORD) });
    await restart();
    out['lockedStatus'] = (await call<{ phase: string }>('status')).phase;
    out['wrongEmail'] = await call('account.signOutLocked', { email: 'someone@else.com' });
    out['afterWrongEmail'] = { files: rt.pool.getFileNames().length > 0, credentials: stored !== undefined };
    out['rightEmail'] = await call('account.signOutLocked', { email: '  C@Example.COM ' });
    out['afterRightEmail'] = left();

    // 4. a sign-out that was cut short: the marker is set, so the very first call, whatever it is, finishes the erase
    await restart();
    await call('createAccount', { email: 'd@example.com', password: bytes(PASSWORD) });
    await call('session.pageHide');
    await new Promise((r) => setTimeout(r, 50));
    marked = true; // what a crash after the first step leaves behind
    events.length = 0;
    app = build();
    server = createRpcServer(app.handlers);
    call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    out['firstCallIsUnlock'] = await call('unlock', { password: bytes(PASSWORD) });
    out['afterFinish'] = left();
    const status = await call('status');
    out['statusAfterFinish'] = status;
    out['statusAgain'] = await call('status');
    out['finishedAnnounced'] = events.filter((e) => e === 'SignedOut').length;
    return out;
  },

  /** Moving an account between groups (spec 012) through the worker handlers over the real encrypted database. */
  async groupMove(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const PASSWORD = 'correct horse battery staple';
    let stored: DeviceCredentials | undefined;
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    let savedSettings: unknown;
    const app = createAppHandlers({
      runtime: async () => rt, rng, credentials, nowMs: () => Date.UTC(2026, 2, 1, 12), onLocked: () => undefined,
      accountCrypto: createAccountCrypto({ rng, kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } }),
      settings: { load: async () => parseSettings(savedSettings), save: async (x) => void (savedSettings = x) },
      quickStore: { load: async () => undefined, save: async () => undefined, clear: async () => undefined },
      quickCrypto: { enroll: async () => 'wrong_password', unlock: async () => 'failed' },
    });
    const server = createRpcServer(app.handlers);
    const call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    type Ok<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const out: Record<string, unknown> = {};

    const created = await call<Ok<{ fold: { id: string } }>>('createAccount', { email: 'a@example.com', password: new TextEncoder().encode(PASSWORD), server: 'https://relay.example.com', discoverable: true, baseCurrency: 'USD' });
    if (!created.ok) throw new Error('sign-up failed');
    const fold = created.value.fold.id;
    const acct = await call<Ok<{ id: string }>>('ledger.createAccount', { fold, kind: 'checking', name: 'Checking', currency: 'USD', openingBalanceMinor: 100n, openingDate: 20_260_101 });
    const first = await call<Ok<string>>('ledger.createGroup', { fold, name: 'Household' });
    const second = await call<Ok<string>>('ledger.createGroup', { fold, name: 'Savings' });
    if (!acct.ok || !first.ok || !second.ok) throw new Error('setup failed');
    const groupsOf = async () => {
      const b = await call<Ok<{ accounts: Array<{ id: string; groupIds: string[] }> }>>('ledger.basics', { fold });
      return b.ok ? b.value.accounts.find((a) => a.id === acct.value.id)!.groupIds : b.error;
    };
    const move = (group: string | null) => call<Ok<unknown>>('ledger.moveAccountToGroup', { fold, account: acct.value.id, group });

    out['ids'] = { first: first.value, second: second.value };
    out['name'] = await call('ledger.createGroup', { fold, name: ' household ' });
    out['intoFirst'] = [(await move(first.value)).ok, await groupsOf()];
    out['intoSecond'] = [(await move(second.value)).ok, await groupsOf()];
    out['out'] = [(await move(null)).ok, await groupsOf()];
    await call('ledger.deleteGroup', { fold, id: second.value });
    out['toDeleted'] = [await move(second.value), await groupsOf()];
    await call('session.pageHide');
    return out;
  },

  /** The ledger (user story 2) over the real encrypted database, driven through the worker handlers. */
  async ledger(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const PASSWORD = 'correct horse battery staple';
    let stored: DeviceCredentials | undefined;
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    let savedSettings: unknown;
    const time = { now: Date.UTC(2026, 2, 1, 12) };
    const build = () => createAppHandlers({
      runtime: async () => rt, rng, credentials, nowMs: () => time.now, onLocked: () => undefined,
      accountCrypto: createAccountCrypto({ rng, kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } }),
      settings: { load: async () => parseSettings(savedSettings), save: async (s) => void (savedSettings = s) },
      quickStore: { load: async () => undefined, save: async () => undefined, clear: async () => undefined },
      quickCrypto: { enroll: async () => 'wrong_password', unlock: async () => 'failed' },
    });
    const bytes = (text: string) => new TextEncoder().encode(text);
    const out: Record<string, unknown> = {};
    type Ok<T> = { ok: true; value: T } | { ok: false; error: { code: string } };

    let app = build();
    let server = createRpcServer(app.handlers);
    let call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    const created = await call<Ok<{ fold: { id: string } }>>('createAccount', { email: 'a@example.com', password: bytes(PASSWORD), server: 'https://relay.example.com', discoverable: true, baseCurrency: 'USD' });
    if (!created.ok) throw new Error('sign-up failed');
    const fold = created.value.fold.id;

    const basics0 = await call<Ok<{ categories: unknown[]; baseCurrency: string; accounts: unknown[] }>>('ledger.basics', { fold });
    out['seeded'] = basics0.ok ? { categories: basics0.value.categories.length, base: basics0.value.baseCurrency, accounts: basics0.value.accounts.length } : basics0;

    const day = (y: number, m: number, d: number) => y * 10_000 + m * 100 + d;
    const main = await call<Ok<{ id: string }>>('ledger.createAccount', { fold, kind: 'checking', name: 'Zebra Savings', currency: 'USD', openingBalanceMinor: 100_000n, openingDate: day(2026, 1, 1) });
    const euro = await call<Ok<{ id: string }>>('ledger.createAccount', { fold, kind: 'cash', name: 'Euro wallet', currency: 'EUR', openingBalanceMinor: 0n, openingDate: day(2026, 1, 1) });
    if (!main.ok || !euro.ok) throw new Error('account creation failed');
    const payee = await call<Ok<string>>('ledger.createPayee', { fold, name: 'Quokka Cafe' });
    const tagA = await call<Ok<string>>('ledger.createTag', { fold, name: 'fun' });
    const tagB = await call<Ok<string>>('ledger.createTag', { fold, name: 'work' });
    if (!payee.ok || !tagA.ok || !tagB.ok) throw new Error('labels failed');
    const cats = basics0.ok ? (basics0.value.categories as Array<{ id: string; name: string; direction: string; parentId: string | null }>) : [];
    const food = cats.find((c) => c.name === 'Groceries')!;

    const big = 2n ** 58n + 1n;
    const coffee = await call<Ok<{ id: string; baseAmountMinor: bigint }>>('ledger.addTransaction', {
      fold, accountId: main.value.id, direction: 'expense', amountMinor: -450n, currency: 'USD', occurredUtcMs: time.now, tzOffsetMin: 0,
      categoryId: food.id, payeeId: payee.value, tagIds: [tagA.value, tagB.value], note: 'flat white',
    });
    const windfall = await call<Ok<{ id: string }>>('ledger.addTransaction', { fold, accountId: main.value.id, direction: 'income', amountMinor: big, currency: 'USD', occurredUtcMs: time.now + 1000, tzOffsetMin: 0 });
    const needsRate = await call<Ok<unknown>>('ledger.addTransaction', { fold, accountId: euro.value.id, direction: 'expense', amountMinor: -1_000n, currency: 'EUR', occurredUtcMs: time.now, tzOffsetMin: 0 });
    out['needsRate'] = needsRate.ok ? 'added' : needsRate.error;
    await call('ledger.setCustomRate', { fold, quote: 'EUR', asOfUtcS: Number(BigInt(time.now) / 1000n) - 10, rateE12: 900_000_000_000n });
    const eur = await call<Ok<{ baseAmountMinor: bigint }>>('ledger.addTransaction', { fold, accountId: euro.value.id, direction: 'expense', amountMinor: -900n, currency: 'EUR', occurredUtcMs: time.now, tzOffsetMin: 0 });
    out['eurBase'] = eur.ok ? eur.value.baseAmountMinor : eur.error;
    if (!coffee.ok || !windfall.ok) throw new Error('transactions failed');

    const basics = await call<Ok<{ accounts: Array<{ name: string; balanceMinor: bigint | null }> }>>('ledger.basics', { fold });
    out['balances'] = basics.ok ? basics.value.accounts.map((a) => [a.name, a.balanceMinor]) : basics.error;
    out['expectedMain'] = 100_000n - 450n + big;

    const list = await call<Ok<{ items: Array<{ id: string; tagIds: string[]; amountMinor: bigint }>; count: number }>>('ledger.transactions', { fold, filter: { text: 'quokka' } });
    out['search'] = list.ok ? { count: list.value.count, tags: list.value.items[0]?.tagIds.length, amount: list.value.items[0]?.amountMinor } : list.error;
    const period = { from: day(2026, 3, 1), to: day(2026, 3, 31) };
    const dash = await call<Ok<{ netWorth: { totalMinor: bigint | null }; incomeExpense: { expenseMinor: bigint; incomeMinor: bigint } }>>('ledger.dashboard', {
      fold, period, asOf: day(2026, 3, 31), options: { adjustmentsAsIncomeExpense: false, transfersAsIncomeExpense: false },
    });
    out['dashboard'] = dash.ok ? { net: dash.value.netWorth.totalMinor, expense: dash.value.incomeExpense.expenseMinor, income: dash.value.incomeExpense.incomeMinor } : dash.error;

    // delete, recently deleted, restore, delete again, and purge after 30 days
    await call('ledger.deleteTransaction', { fold, id: coffee.value.id });
    const deleted = await call<Ok<Array<{ daysLeft: number }>>>('ledger.recentlyDeleted', { fold });
    out['recentlyDeleted'] = deleted.ok ? deleted.value.map((d) => d.daysLeft) : deleted.error;
    await call('ledger.restoreTransaction', { fold, id: coffee.value.id });
    await call('ledger.deleteTransaction', { fold, id: coffee.value.id });
    time.now += 31 * 24 * 60 * 60 * 1000;
    out['purged'] = ((await call<string[]>('ledger.purge', { fold })).length);
    out['afterPurge'] = await call('ledger.restoreTransaction', { fold, id: coffee.value.id });
    const after = await call<Ok<{ count: number }>>('ledger.transactions', { fold });
    out['countAfterPurge'] = after.ok ? after.value.count : after.error;

    // lock, then unlock a fresh session over the same file: everything is still there, exactly
    await call('session.pageHide');
    await new Promise((r) => setTimeout(r, 50));
    app = build();
    server = createRpcServer(app.handlers);
    call = <T = unknown>(method: string, args?: unknown) => server.invoke(method, args) as Promise<T>;
    out['unlockedAgain'] = ((await call<Ok<unknown>>('unlock', { password: bytes(PASSWORD) })).ok);
    const reopened = await call<Ok<{ accounts: Array<{ name: string; balanceMinor: bigint | null }> }>>('ledger.basics', { fold });
    out['reopenedBalances'] = reopened.ok ? reopened.value.accounts.map((a) => [a.name, a.balanceMinor]) : reopened.error;

    // nothing readable on disk
    const leaks: string[] = [];
    for (const name of rt.pool.getFileNames()) {
      const text = latin1(await rt.pool.exportFile(name));
      for (const marker of ['Zebra Savings', 'Quokka', 'flat white', 'Euro wallet', 'Groceries']) if (text.includes(marker)) leaks.push(`${name}:${marker}`);
    }
    out['leaks'] = leaks;
    await call('session.pageHide');
    return out;
  },

  /** The whole of user story 1 against the real encrypted database: sign up, lock, unlock. */
  async signUpAndUnlock(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const PASSWORD = 'correct horse battery staple';
    const accountCrypto = createAccountCrypto({ rng, kdf: { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } });
    let stored: DeviceCredentials | undefined;
    const credentials: CredentialStorePort = { save: async (c) => void (stored = c), load: async () => stored, clear: async () => void (stored = undefined) };
    const offline: RegistrationResult = { ok: false, reason: 'offline' };

    // --- sign up (offline) ---
    const s1 = createSession({ closeDatabase: async () => void webSession1.stop(), terminateWorker: () => undefined, nowMs: Date.now });
    const webSession1 = createWebSession({ runtime: rt, rng, isUnlocked: () => s1.state() === 'unlocked' });
    const created = await createAccount({ crypto: accountCrypto, registration: { register: async () => offline }, credentials, sessionPort: webSession1, session: s1, random: rng })({
      email: 'Alice@Example.com', password: pwBuf(PASSWORD), server: 'https://relay.example.com', discoverable: true,
    });
    if (!created.ok) throw new Error(`sign-up failed: ${created.error.code}`);
    const open = webSession1.current()!;
    const folds = await open.directory.list();
    const settings = await open.projections.getRecord(folds[0]!.id, (await import('@cashfold/core')).settingsRecordId(folds[0]!.id));
    const opCount = open.db.value('SELECT count(*) FROM op_log');
    const keyRows = open.db.value('SELECT count(*) FROM fold_key');
    const wrappedKey = open.db.value('SELECT fk_wrapped FROM fold_key') as Uint8Array;

    // what is on disk in OPFS (everything the database holds is encrypted)
    const marker = 'Personal';
    const leaks: string[] = [];
    for (const name of rt.pool.getFileNames()) {
      const text = latin1(await rt.pool.exportFile(name));
      if (text.includes(marker) || text.includes('SQLite format 3') || text.includes('alice@example.com')) leaks.push(name);
    }
    const afterSignUp = {
      secretKeyText: created.value.secretKeyText, registration: created.value.registration, accountState: created.value.account.state,
      fold: created.value.fold, folds: folds.map((f) => f.name), settingsName: settings?.fields.get(1)?.value, opCount, keyRows, wrappedKeyLength: wrappedKey.length, leaks,
      storedRegistration: stored?.registration, storedEmail: stored?.email,
    };

    // --- lock ---
    await s1.lock();
    const afterLock = { state: s1.state(), covered: s1.covered(), sessionOpen: webSession1.current() !== undefined };

    // --- unlock in a fresh session, as after a restart ---
    const s2 = createSession({ closeDatabase: async () => void webSession2.stop(), terminateWorker: () => undefined, nowMs: Date.now });
    const webSession2 = createWebSession({ runtime: rt, rng, isUnlocked: () => s2.state() === 'unlocked' });
    const attempt = unlock({ unlockCrypto: accountCrypto, credentials, sessionPort: webSession2, session: s2 });
    const wrong = await attempt({ password: pwBuf('this is not the password') });
    const good = await attempt({ password: pwBuf(`  ${PASSWORD}\n`) }); // stray whitespace must not matter
    const reopenedFolds = good.ok ? (await good.value.services.directory.list()).map((f) => f.name) : [];
    const reopened = webSession2.current();
    const reopenedSettings = good.ok && reopened ? (await reopened.projections.getRecord(folds[0]!.id, (await import('@cashfold/core')).settingsRecordId(folds[0]!.id)))?.fields.get(1)?.value : undefined;
    // the write path still works after a restart: a new op continues the device's sequence
    const more = reopened ? await reopened.writePath.rebuild(folds[0]!.id) : undefined;
    await s2.lock();
    return {
      afterSignUp, afterLock,
      wrongPassword: wrong.ok ? 'unlocked' : wrong.error.code,
      unlocked: good.ok, accountId: good.ok ? good.value.accountId : undefined, reopenedFolds, reopenedSettings,
      rebuild: more && more.ok ? more.value : undefined, lockedAgain: s2.state(),
    };
  },

  /** Runs one case of the shared OpLogStore/ProjectionStore contract against the SQLite stores. */
  async contractCase(ctx: ScenarioContext) {
    const c = storeContract[ctx.arg ?? -1];
    if (c === undefined) throw new RangeError('no such contract case');
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const stores = {
        oplog: createSqliteOpLog(db),
        projections: createSqliteProjections(db),
        async prepareFold(fold: Id) {
          db.run('INSERT OR IGNORE INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, ?, 1, 1, ?, 0)', [idToBytes(fold), 'Test Fold', 'USD']);
        },
      };
      return c.run(stores);
    });
  },

  async bigints(ctx: ScenarioContext) {
    return withDb(ctx, 1, (db) => {
      db.exec('CREATE TABLE m(id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL) STRICT');
      const values = [2n ** 62n + 1n, 2n ** 53n + 1n, 9007199254740993n, -(2n ** 62n) - 3n, 5n, 0n];
      values.forEach((v, i) => db.run('INSERT INTO m VALUES (?, ?)', [i + 1, v]));
      const sum = db.value('SELECT SUM(amount_minor) FROM m');
      const rows = db.rows('SELECT id, amount_minor FROM m ORDER BY id');
      db.run('INSERT INTO m VALUES (?, ?)', [100, 9223372036854775807n]);
      db.run('INSERT INTO m VALUES (?, ?)', [101, -9223372036854775808n]);
      return {
        sum,
        expectedSum: values.reduce((a, b) => a + b, 0n),
        types: rows.map((r) => `${typeof r[0]}/${typeof r[1]}`),
        roundTrip: rows.map((r) => r[1]),
        extremes: db.rows('SELECT amount_minor FROM m WHERE id >= 100 ORDER BY id').map((r) => r[0]),
      };
    });
  },

  async bindRules(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE m(v INTEGER) STRICT');
      return {
        unsafe: await throws(() => db.run('INSERT INTO m VALUES (?)', [2 ** 53])),
        float: await throws(() => db.run('INSERT INTO m VALUES (?)', [1.5])),
        nan: await throws(() => db.run('INSERT INTO m VALUES (?)', [Number.NaN])),
        safe: await throws(() => db.run('INSERT INTO m VALUES (?)', [42])),
        strictText: await throws(() => db.run("INSERT INTO m VALUES ('abc')")),
        stored: db.rows('SELECT v, typeof(v) FROM m'),
      };
    });
  },

  async sumOverflow(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE m(v INTEGER) STRICT');
      db.run('INSERT INTO m VALUES (?)', [9223372036854775807n]);
      db.run('INSERT INTO m VALUES (?)', [1n]);
      return { sum: await throws(() => db.value('SELECT SUM(v) FROM m')) };
    });
  },

  async encryptedAtRest(ctx: ScenarioContext) {
    const marker = 'SECRET-MARKER-groceries-4711';
    const rt = await runtimeFor(ctx);
    const db = EncryptedDatabase.open(rt, '/test.db', key(1));
    db.exec('CREATE TABLE n(id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT');
    for (let i = 0; i < 200; i++) db.run('INSERT INTO n VALUES (?, ?)', [i, `${marker}-${i}`]);
    await db.transaction(() => db.run("UPDATE n SET note = 'JOURNAL-MARKER-in-flight' WHERE id = 1"));
    // Look at every file in the pool while a write transaction is open: database and rollback journal.
    db.exec('BEGIN');
    db.run("UPDATE n SET note = 'JOURNAL-MARKER-mid-transaction' WHERE id = 2");
    const names = rt.pool.getFileNames();
    const leaks: string[] = [];
    for (const name of names) {
      const bytes = await rt.pool.exportFile(name);
      const text = latin1(bytes);
      if (text.includes('SECRET-MARKER') || text.includes('JOURNAL-MARKER') || text.startsWith('SQLite format 3')) leaks.push(name);
    }
    db.exec('COMMIT');
    db.close();
    const onDisk = await rt.pool.exportFile('/test.db');
    const wrongKey = await throws(() => EncryptedDatabase.open(rt, '/test.db', key(2)));
    const reopened = EncryptedDatabase.open(rt, '/test.db', key(1));
    const count = reopened.value('SELECT count(*) FROM n');
    reopened.close();
    return { names, leaks, hasMagic: latin1(onDisk.slice(0, 16)).startsWith('SQLite format 3'), hasMarker: latin1(onDisk).includes(marker), size: onDisk.length, wrongKey, count };
  },

  async tamper(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const seed = () => {
      const db = EncryptedDatabase.open(rt, '/test.db', key(1));
      db.exec('CREATE TABLE n(id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT');
      for (let i = 0; i < 400; i++) db.run('INSERT INTO n VALUES (?, ?)', [i, `row ${i} ${'x'.repeat(40)}`]);
      db.close();
    };
    const check = async () => {
      try {
        const db = EncryptedDatabase.open(rt, '/test.db', key(1));
        try {
          const n = db.value('SELECT count(*) FROM n');
          const all = db.rows('SELECT * FROM n');
          return `opened: count=${n} rows=${all.length}`;
        } finally {
          db.close();
        }
      } catch (e) {
        return `rejected: ${(e as Error).name}`;
      }
    };
    const out: Record<string, string> = {};
    seed();
    out['control'] = await check();
    const page = 4096;
    await rawEdit(rt, ctx.dir, '/test.db', (sah) => {
      const b = new Uint8Array(1);
      sah.read(b, { at: 4096 + page * 2 + 100 });
      b[0] = b[0]! ^ 1;
      sah.write(b, { at: 4096 + page * 2 + 100 });
    });
    out['oneBitFlip'] = await check();
    await rawEdit(rt, ctx.dir, '/test.db', (sah) => {
      const b = new Uint8Array(1);
      sah.read(b, { at: 4096 + page * 2 + 100 });
      b[0] = b[0]! ^ 1;
      sah.write(b, { at: 4096 + page * 2 + 100 });
    });
    out['restored'] = await check();
    await rawEdit(rt, ctx.dir, '/test.db', (sah) => {
      const copy = new Uint8Array(page);
      sah.read(copy, { at: 4096 + page * 3 });
      sah.write(copy, { at: 4096 + page * 2 });
    });
    out['pageCopiedOverAnother'] = await check();
    return out;
  },

  async migrations(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      const first = await migrate(db);
      const tables = db.rows("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").map((r) => r[0] as string);
      const again = await migrate(db);
      const version = db.userVersion;

      const bad: Migration[] = [
        { version: 1, name: 'ok', sql: 'CREATE TABLE a(x INTEGER) STRICT' },
        { version: 2, name: 'broken', sql: 'CREATE TABLE b(x INTEGER) STRICT; CREATE TABLE a(x INTEGER) STRICT' },
      ];
      const scratch = EncryptedDatabase.open(await runtimeFor(ctx), '/scratch.db', key(1));
      const failure = await throws(() => migrate(scratch, bad));
      const afterFailure = { version: scratch.userVersion, hasA: scratch.rows("SELECT name FROM sqlite_master WHERE name IN ('a','b') ORDER BY name").map((r) => r[0]) };
      scratch.close();

      db.exec('PRAGMA user_version = 999');
      const tooNew = await throws(() => migrate(db));
      return { first, again, version, tables, failure, afterFailure, tooNew, isMigrationError: tooNew.startsWith(MigrationError.name) };
    });
  },

  /** The plans of the queries the app runs on every start and every change (ARCH 8.2): each must use an index, not scan or sort a table. */
  async queryPlans(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const f = idToBytes('00000000-0000-4000-8000-0000000000f1' as Id);
      const r = new Uint8Array(16);
      const queries: Record<string, { sql: string; bind: Bind[] }> = {
        pendingToPush: { sql: 'SELECT op_id FROM op_log WHERE fold_id = ? AND state = 0 ORDER BY dev_seq', bind: [f] },
        newestStamp: { sql: 'SELECT hlc_wall, hlc_ctr FROM op_log WHERE fold_id = ? ORDER BY hlc_wall DESC, hlc_ctr DESC LIMIT 1', bind: [f] },
        opAlreadyHeld: { sql: 'SELECT 1 FROM op_log WHERE fold_id = ? AND op_id = ?', bind: [f, r] },
        deviceSequence: { sql: 'SELECT MAX(dev_seq) FROM op_log WHERE fold_id = ? AND dev_id = ?', bind: [f, r] },
        deviceSequenceTaken: { sql: 'SELECT 1 FROM op_log WHERE fold_id = ? AND dev_id = ? AND dev_seq = ?', bind: [f, r, 1n] },
        oneRecordMeta: { sql: 'SELECT table_code, table_conflict FROM record_meta WHERE fold_id = ? AND rec_id = ?', bind: [f, r] },
        oneRecordFields: { sql: 'SELECT field_id, hlc_wall, hlc_ctr, dev_id, op_id, value FROM field_clock WHERE fold_id = ? AND rec_id = ?', bind: [f, r] },
        oneRecordSets: { sql: 'SELECT rec_id, field_id, member, tag FROM set_add WHERE fold_id = ? AND rec_id = ?', bind: [f, r] },
        wholeFold: { sql: 'SELECT rec_id, state FROM record_blob WHERE fold_id = ? ORDER BY rec_id', bind: [f] },
        recordCount: { sql: 'SELECT count(*) FROM record_meta WHERE fold_id = ?', bind: [f] },
        anyData: { sql: 'SELECT 1 FROM record_meta WHERE table_code IN (1, 6, 7) LIMIT 1', bind: [] },
        purged: { sql: 'SELECT 1 FROM purged_record WHERE fold_id = ? AND rec_id = ?', bind: [f, r] },
        unsentPieces: { sql: 'SELECT fold_id, att_id, idx FROM attachment_chunk WHERE sent = 0 ORDER BY fold_id, att_id, idx', bind: [] },
        membershipLog: { sql: 'SELECT entry FROM fold_log WHERE fold_id = ? ORDER BY idx', bind: [f] },
      };
      const plans: Record<string, string[]> = {};
      for (const [name, q] of Object.entries(queries)) plans[name] = db.rows(`EXPLAIN QUERY PLAN ${q.sql}`, q.bind).map((row) => String(row[3]));
      return plans;
    });
  },

  /** Reading a whole Fold back (every view starts here): time, and that it equals reading the records one by one. */
  async bigFold(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const projections = createSqliteProjections(db);
      const fold = '00000000-0000-4000-8000-0000000000f1' as Id;
      db.run("INSERT INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, 'Home', 1, 1, 'USD', 0)", [idToBytes(fold)]);
      const records = ctx.arg ?? 2000;
      const dev = '00000000-0000-4000-8000-0000000000d1' as Id;
      const id = (n: number, kind: number): Id => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}` as Id;
      await db.transaction(async () => {
        for (let n = 0; n < records; n++) {
          const fields = new Map<number, { hlc: { wallMs: number; ctr: number }; dev: Id; opId: Id; value: never }>();
          const op = id(n, 2);
          const put = (field: number, value: unknown) => fields.set(field, { hlc: { wallMs: 1_800_000_000_000 + n, ctr: field % 3 }, dev, opId: op, value: value as never });
          put(1, id(n % 7, 3)); put(2, 1n); put(3, BigInt(-100 - (n % 90))); put(4, 'USD'); put(5, BigInt(-100 - (n % 90))); put(6, 'USD'); put(8, BigInt(1_800_000_000_000 + n));
          put(9, 0n); put(10, BigInt(20_260_101 + (n % 28))); put(11, id(n % 20, 4)); put(12, id(n % 50, 5)); put(14, `Row ${n}`); put(18, null); put(19, false); put(20, false); put(21, 1n);
          await projections.putRecord(fold, id(n, 1), { table: 6, tableConflict: false, fields, sets: new Map() });
        }
      });
      const times: number[] = [];
      let listed = new Map();
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        listed = await projections.listRecords(fold) as never;
        times.push(Math.round(performance.now() - t0));
      }
      const t1 = performance.now();
      let rows = 0;
      let bytes = 0;
      db.forEachRow('SELECT m.rec_id, m.table_code, m.table_conflict, c.field_id, c.hlc_wall, c.hlc_ctr, c.dev_id, c.op_id, c.value FROM record_meta m LEFT JOIN field_clock c ON c.fold_id = m.fold_id AND c.rec_id = m.rec_id WHERE m.fold_id = ? ORDER BY m.rec_id, c.field_id', [idToBytes(fold)], (r) => { rows++; bytes += (r[8] as Uint8Array).length; }, 'small');
      const stepOnly = Math.round(performance.now() - t1);
      const t2 = performance.now();
      db.forEachRow('SELECT c.rec_id FROM field_clock c WHERE c.fold_id = ?', [idToBytes(fold)], () => undefined, 'small');
      const scanOnly = Math.round(performance.now() - t2);
      const t3 = performance.now();
      const sample = decodeValue(encodeValue('USD'));
      for (let i = 0; i < rows; i++) decodeValue(encodeValue(i % 2 ? 'USD' : BigInt(i)));
      const decodeOnly = Math.round(performance.now() - t3);
      void sample;
      // Same content as reading one by one, on a sample spread over the Fold.
      let same = listed.size === records;
      for (const n of [0, 1, Math.floor(records / 2), records - 1]) {
        const one = await projections.getRecord(fold, id(n, 1));
        const all = listed.get(id(n, 1)) as { table: number; fields: Map<number, unknown> } | undefined;
        same &&= one !== undefined && all !== undefined && one.table === all.table && one.fields.size === all.fields.size
          && [...one.fields].every(([f, e]) => JSON.stringify(e, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)) === JSON.stringify(all.fields.get(f), (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
      }
      // A database without the copies reads the rows once, writes the copies, and gives the same answer.
      db.run('DELETE FROM record_blob');
      const slowAt = performance.now();
      const rebuilt = await projections.listRecords(fold);
      const slow = Math.round(performance.now() - slowAt);
      const copies = Number(db.value('SELECT count(*) FROM record_blob'));
      const fastAt = performance.now();
      const again = await projections.listRecords(fold);
      const fast = Math.round(performance.now() - fastAt);
      const agree = rebuilt.size === again.size && [...rebuilt].every(([k, v]) => JSON.stringify([...v.fields], (_x, y) => (typeof y === 'bigint' ? `${y}n` : y)) === JSON.stringify([...(again.get(k)?.fields ?? [])], (_x, y) => (typeof y === 'bigint' ? `${y}n` : y)));
      return { records, times, same, note: { stepOnly, scanOnly, decodeAndEncode: decodeOnly, rows, bytes, slow, fast, copies, agree } };
    });
  },

  async recovery(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const schema = async (db: EncryptedDatabase) => {
      db.exec(`CREATE TABLE IF NOT EXISTS fold(fold_id BLOB PRIMARY KEY, name TEXT NOT NULL, pull_cursor INTEGER NOT NULL DEFAULT 0, last_synced_at INTEGER) STRICT;
               CREATE TABLE IF NOT EXISTS op_log(id INTEGER PRIMARY KEY, fold_id BLOB NOT NULL, body BLOB NOT NULL) STRICT;
               CREATE TABLE IF NOT EXISTS txn(id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT`);
    };
    const make = async (file: string, rows: number) => {
      const db = EncryptedDatabase.open(rt, file, key(1));
      await schema(db);
      db.run("INSERT INTO fold VALUES (?, 'Home', 77, 123)", [new Uint8Array(16).fill(1)]);
      await db.transaction(() => {
        for (let i = 0; i < rows; i++) db.run('INSERT INTO op_log VALUES (?, ?, ?)', [i, new Uint8Array(16).fill(1), new Uint8Array(300).fill(i & 255)]);
        for (let i = 0; i < 50; i++) db.run('INSERT INTO txn VALUES (?, ?)', [i, `derived ${i}`]);
      });
      db.close();
    };
    const out: Record<string, unknown> = {};

    // 1. a healthy database is opened as it is
    await make('/ok.db', 300);
    const healthy = await openOrRecover(rt, '/ok.db', key(1), 1_000, schema);
    out['healthy'] = { recovered: healthy.report !== undefined, ops: healthy.db.value('SELECT count(*) FROM op_log'), cursor: healthy.db.value('SELECT pull_cursor FROM fold') };
    healthy.db.close();

    // 2. a page in the middle is damaged: what comes before and after it is kept as far as it can be read
    await make('/hurt.db', 3000);
    const before = (await rt.pool.exportFile('/hurt.db')).length;
    await rawEdit(rt, ctx.dir, '/hurt.db', (sah) => {
      const at = 4096 + 4096 * 200;
      sah.write(crypto.getRandomValues(new Uint8Array(512)), { at });
    });
    const hurt = await openOrRecover(rt, '/hurt.db', key(1), 2_000, schema);
    const names = rt.pool.getFileNames();
    out['damaged'] = {
      reason: hurt.report?.reason,
      damagedFile: hurt.report?.damagedFile,
      newFile: hurt.report?.newFile,
      usingFile: hurt.db.file,
      damagedStillThere: names.includes('/hurt.db'),
      damagedSize: names.includes('/hurt.db') ? (await rt.pool.exportFile('/hurt.db')).length : 0,
      originalSize: before,
      folds: hurt.db.value('SELECT count(*) FROM fold'),
      cursor: hurt.db.value('SELECT pull_cursor FROM fold'),
      syncedAt: hurt.db.value('SELECT last_synced_at FROM fold'),
      opsKept: Number(hurt.db.value('SELECT count(*) FROM op_log')),
      derivedKept: hurt.db.value('SELECT count(*) FROM txn'),
      copied: hurt.report?.copied,
      incomplete: hurt.report?.incomplete,
      usableAfterwards: (() => { hurt.db.run('INSERT INTO op_log VALUES (?, ?, ?)', [999_999, new Uint8Array(16), new Uint8Array(4)]); return hurt.db.value('SELECT count(*) FROM op_log WHERE id = 999999'); })(),
    };
    hurt.db.close();

    // 3. the first page is damaged: nothing can be read, the old file is still kept as it was, and the new database starts empty
    await make('/gone.db', 200);
    await rawEdit(rt, ctx.dir, '/gone.db', (sah) => sah.write(crypto.getRandomValues(new Uint8Array(200)), { at: 4096 + 16 }));
    const gone = await openOrRecover(rt, '/gone.db', key(1), 3_000, schema);
    out['unreadable'] = { reason: gone.report?.reason, file: gone.db.file, ops: gone.db.value('SELECT count(*) FROM op_log'), folds: gone.db.value('SELECT count(*) FROM fold'), oldThere: rt.pool.getFileNames().includes('/gone.db') };
    gone.db.close();

    // 4. a second time, the newer file is the one set aside, and only that one is kept besides the new database
    await rawEdit(rt, ctx.dir, '/gone.g2.db', (sah) => sah.write(crypto.getRandomValues(new Uint8Array(200)), { at: 4096 + 16 }));
    const again = await openOrRecover(rt, '/gone.db', key(1), 4_000, schema);
    out['second'] = { file: again.db.file, damaged: again.report?.damagedFile };
    again.db.close();
    out['kept'] = rt.pool.getFileNames().filter((n) => n.startsWith('/gone')).sort();

    // 5. wiping a device removes every generation
    const wipe = EncryptedDatabase.open(rt, again.db.file, key(1));
    wipe.destroy();
    out['afterWipe'] = rt.pool.getFileNames().filter((n) => n.startsWith('/gone'));
    return out;
  },

  async attachmentStore(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const store = createSqliteAttachmentStore(db);
      const fold = '00000000-0000-4000-8000-0000000000f1' as Id;
      const att = '00000000-0000-4000-8000-0000000000a1' as Id;
      const piece = Uint8Array.from({ length: 300 }, (_, i) => i & 255);
      await store.put(fold, att, 0, piece, false);
      await store.put(fold, att, 1, piece.slice(0, 10), true);
      const read = await store.get(fold, att, 0);
      const pending = await store.pending();
      await store.markSent(fold, att, 0);
      const after = await store.pending();
      const missing = await store.get(fold, att, 5);
      store.clearFold(fold);
      return { same: read !== undefined && read.length === 300 && read[299] === 43, pending, after, missing: missing === undefined, cleared: (await store.get(fold, att, 0)) === undefined };
    });
  },

  async transactions(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT) STRICT');
      await db.transaction(() => db.run("INSERT INTO t VALUES (1, 'committed')"));
      const rolledBack = await throws(() => db.transaction(() => { db.run("INSERT INTO t VALUES (2, 'lost')"); throw new Error('boom'); }));
      await db.transaction(async () => {
        db.run("INSERT INTO t VALUES (3, 'outer')");
        const inner = await throws(() => db.transaction(() => { db.run("INSERT INTO t VALUES (4, 'inner-lost')"); throw new Error('inner'); }));
        await db.transaction(() => db.run("INSERT INTO t VALUES (5, 'inner-kept')"));
        if (inner === 'no error') throw new Error('inner should have failed');
      });
      const asyncAtomic = await throws(() => db.transaction(async () => {
        db.run("INSERT INTO t VALUES (6, 'async-lost')");
        await Promise.resolve();
        throw new Error('late');
      }));
      return { rolledBack, asyncAtomic, rows: db.rows('SELECT id, v FROM t ORDER BY id') };
    });
  },

  async foreignKeys(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const fold = new Uint8Array(16).fill(9);
      const orphan = await throws(() => db.run('INSERT INTO category(fold_id, id, direction, name) VALUES (?, ?, 1, ?)', [fold, new Uint8Array(16).fill(1), 'Food']));
      db.run('INSERT INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, ?, 1, 1, ?, 0)', [fold, 'Personal', 'USD']);
      db.run('INSERT INTO category(fold_id, id, direction, name) VALUES (?, ?, 1, ?)', [fold, new Uint8Array(16).fill(1), 'Food']);
      const before = db.value('SELECT count(*) FROM category');
      db.run('DELETE FROM fold WHERE fold_id = ?', [fold]);
      return { orphan, before, after: db.value('SELECT count(*) FROM category'), fk: db.value('PRAGMA foreign_keys'), secureDelete: db.value('PRAGMA secure_delete'), temp: db.value('PRAGMA temp_store') };
    });
  },

  async seedPersistence(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      db.exec('CREATE TABLE p(v INTEGER) STRICT');
      db.run('INSERT INTO p VALUES (?)', [2n ** 60n + 7n]);
      return true;
    });
  },

  async readPersistence(ctx: ScenarioContext) {
    return withDb(ctx, 1, (db) => ({ v: db.value('SELECT v FROM p') }));
  },

  async destroy(ctx: ScenarioContext) {
    const rt = await runtimeFor(ctx);
    const db = EncryptedDatabase.open(rt, '/test.db', key(1));
    db.exec('CREATE TABLE d(v INTEGER) STRICT');
    const before = rt.pool.getFileNames();
    db.destroy();
    return { before, after: rt.pool.getFileNames() };
  },

  /** 50,000 transactions: the SC-008 working set. Thresholds are generous; they catch gross regressions only. */
  async benchmark(ctx: ScenarioContext) {
    return withDb(ctx, 1, async (db) => {
      await migrate(db);
      const fold = new Uint8Array(16).fill(1);
      const account = new Uint8Array(16).fill(2);
      db.run('INSERT INTO fold(fold_id, name, epoch, role, base_currency, created_at) VALUES (?, ?, 1, 1, ?, 0)', [fold, 'Personal', 'USD']);
      db.run('INSERT INTO account(fold_id, id, kind, name, currency, exponent, opening_date) VALUES (?, ?, 1, ?, ?, 2, 20260101)', [fold, account, 'Checking', 'USD']);
      const t0 = performance.now();
      await db.transaction(() => {
        for (let i = 0; i < 50_000; i++) {
          const id = new Uint8Array(16);
          new DataView(id.buffer).setUint32(0, i);
          db.run(
            'INSERT INTO txn(fold_id, id, account_id, direction, amount_minor, currency, base_amount_minor, base_currency, occurred_utc_ms, tz_offset_min, local_date, note) VALUES (?,?,?,1,?,?,?,?,?,0,?,?)',
            [fold, id, account, BigInt(-100 - (i % 5000)), 'USD', BigInt(-100 - (i % 5000)), 'USD', 1_760_000_000_000 + i, 20260101 + (i % 300), `note ${i}`],
          );
        }
      });
      const insertMs = performance.now() - t0;
      const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
      const balanceMs = time(() => db.value('SELECT balance_minor FROM account_balance WHERE account_id = ?', [account]));
      const monthMs = time(() => db.rows('SELECT category_id, SUM(amount_minor) FROM txn WHERE fold_id = ? AND local_date BETWEEN 20260101 AND 20260131 AND deleted = 0 GROUP BY category_id', [fold]));
      const listMs = time(() => db.rows('SELECT id, amount_minor FROM txn WHERE fold_id = ? AND account_id = ? AND deleted = 0 ORDER BY local_date DESC, id DESC LIMIT 50', [fold, account]));
      const t1 = performance.now();
      for (let k = 0; k < 20; k++) await db.transaction(() => db.run('UPDATE txn SET note = ? WHERE fold_id = ? AND id = ?', [`edited ${k}`, fold, new Uint8Array(16)]));
      const commitMs = (performance.now() - t1) / 20;
      const plan = db.rows('EXPLAIN QUERY PLAN SELECT id FROM txn WHERE fold_id = ? AND account_id = ? AND deleted = 0 ORDER BY local_date DESC, id DESC LIMIT 50', [fold, account]).map((r) => String(r[3]));
      return { insertMs, balanceMs, monthMs, listMs, commitMs, plan, count: db.value('SELECT count(*) FROM txn') };
    });
  },
} satisfies Record<string, (ctx: ScenarioContext) => unknown>;

export type ScenarioName = keyof typeof scenarios;
