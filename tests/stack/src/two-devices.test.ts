import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createAccount, createAccountCommands, createDeviceManager, createFoldCommands, createSession, ensureRemoteFolds, signInOnNewDevice, registerExisting, idToBytes,
  type AccountSecrets, type Id, type RelayAuthPort,
} from '@cashfold/core';
import { createPake, loadSrpBigint, SecretBuf } from '@cashfold/crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay, type Relay } from '../../../apps/server/src/app';
import type { ServerConfig } from '../../../apps/server/src/config';
import { createMemoryStore } from '../../../apps/server/src/store/memory-store';
import { createAccountCrypto } from '../../../apps/web/src/adapters/account-crypto';
import { createDeviceLabels } from '../../../apps/web/src/adapters/transport/device-labels';
import { createFoldGrantPort } from '../../../apps/web/src/adapters/transport/fold-grants';
import { createWebRelayAuth } from '../../../apps/web/src/adapters/transport/relay-auth';
import { createWebRegistration } from '../../../apps/web/src/adapters/transport/registration';
import { createSyncService, type SyncIdentity } from '../../../apps/web/src/worker/sync-service';
import { createNodeSession, memoryCredentials, rng, sessionPortFor, type NodeSession } from './harness';

const SERVER = 'https://relay.example.test';
const PASSWORD = 'correct horse battery staple';
const FAST = { kdf: 'argon2id', mKib: 32768, t: 2, p: 1 } as const;
const wasmDir = new URL('../../../packages/crypto/src/adapters/srp-wasm/', import.meta.url);
let pakeP: ReturnType<typeof makePake> | undefined;
const makePake = async () => createPake({ bn: await loadSrpBigint(new Uint8Array(readFileSync(new URL('srp-bigint.wasm', wasmDir))), readFileSync(new URL('srp-bigint.wasm.sha256', wasmDir), 'utf8')), rng });
const pake = () => (pakeP ??= makePake());

const config: ServerConfig = {
  port: 0, store: 'memory', databaseUrl: '', serverSecret: randomBytes(32), registration: 'open', inviteCodes: [], mail: { kind: 'none' }, publicUrl: 'https://app.example.test',
  rates: { kind: 'disabled' }, defaultKdf: { mKib: 65_536, t: 3, p: 1 }, allowedOrigins: ['https://app.example.test'],
};

let relay: Relay | undefined;
const clock = { now: 1_800_000_000_000 };
afterEach(async () => {
  network.up = true;
  await relay?.close();
  relay = undefined;
});

/** `fetch` that goes straight into the in-process relay, or fails like a dead network while `network.up` is false. */
const network = { up: true };
const fetchImpl = async (input: string, init: RequestInit): Promise<Response> => {
  if (!network.up) throw new TypeError('network down');
  const url = new URL(input);
  const res = await relay!.app.inject({
    method: (init.method ?? 'GET') as 'GET', url: `${url.pathname}${url.search}`, headers: init.headers as Record<string, string>,
    ...(init.body !== undefined && init.body !== null && { payload: Buffer.from(init.body as Uint8Array) }), remoteAddress: '203.0.113.9',
  });
  return new Response(res.statusCode === 204 ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers: res.headers as Record<string, string> });
};

async function world() {
  relay = await createRelay({ config, store: createMemoryStore(), clock: { now: () => clock.now } });
  const auth: RelayAuthPort = createWebRelayAuth({ pake, fetchImpl, nowMs: () => clock.now });
  const crypto = createAccountCrypto({ rng, kdf: FAST, pake });
  return { auth, crypto };
}

interface Device {
  readonly holder: { session?: NodeSession | undefined };
  readonly creds: ReturnType<typeof memoryCredentials>;
  readonly sync: ReturnType<typeof createSyncService>;
  readonly events: Array<{ type: string }>;
  identity?: SyncIdentity;
  readonly session: () => NodeSession;
}

function makeDevice(auth: RelayAuthPort, getIdentity: () => SyncIdentity | undefined): Device {
  const holder: { session?: NodeSession | undefined } = {};
  const events: Array<{ type: string }> = [];
  const grants = createFoldGrantPort({ keyring: () => holder.session?.keyring as never, rng });
  const sync = createSyncService({
    auth, grants, session: () => holder.session, nowMs: () => clock.now, publish: (e) => void events.push(e), openStream: async () => undefined, pollMs: 3_600_000, retryMs: { first: 10, max: 10 },
  });
  void getIdentity;
  return { holder, creds: memoryCredentials(), sync, events, session: () => holder.session! };
}

describe('two devices through the real relay', () => {
  it('signs up on A, enrols B from the password and Secret Key, and keeps them in step', async () => {
    const { auth, crypto } = await world();
    const a = makeDevice(auth, () => undefined);
    const sessionA = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => clock.now });
    const portA = sessionPortFor(a.holder, (s) => createNodeSession({ deviceId: s.deviceId, deviceSigningKey: s.deviceSigningKey as SecretBuf }, () => clock.now));

    const created = await createAccount({ crypto, registration: createWebRegistration({ fetchImpl }), credentials: a.creds, sessionPort: portA, session: sessionA, random: rng })({
      email: 'alice@example.com', password: SecretBuf.from(new TextEncoder().encode(PASSWORD)), server: SERVER, discoverable: true,
    });
    if (!created.ok) throw new Error(`sign-up failed: ${created.error.code}`);
    expect(created.value.registration).toBe('done');
    const idA: SyncIdentity = { email: 'alice@example.com', accountId: created.value.accountId, server: SERVER, account: created.value.sync!.account, publicKeys: created.value.sync!.publicKeys };

    const foldId = created.value.fold.id;
    const sA = a.session();
    const added = await sA.commandBus.execute(createAccountCommands().createAccountRecord, { fold: foldId, id: '00000000-0000-4000-8000-0000000000a1' as Id, kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: 20_260_101 as never });
    expect(added.ok).toBe(true);

    a.sync.start(idA, 'done');
    await a.sync.syncNow();
    await vi_waitFor(async () => (await a.sync.snapshot()).connection === 'online');
    await a.sync.syncNow();
    expect((await a.sync.snapshot()).folds[0]).toMatchObject({ state: 'synced', pendingOps: 0 });

    // --- B enrols with only the password and the Secret Key
    const b = makeDevice(auth, () => undefined);
    const sessionB = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => clock.now });
    const portB = sessionPortFor(b.holder, (s) => createNodeSession({ deviceId: s.deviceId, deviceSigningKey: s.deviceSigningKey as SecretBuf }, () => clock.now));
    const grants = createFoldGrantPort({ keyring: () => b.holder.session?.keyring as never, rng });
    const signedIn = await signInOnNewDevice({ relay: auth, enrolCrypto: crypto, grants, credentials: b.creds, sessionPort: portB, session: sessionB, random: rng })({
      email: 'alice@example.com', server: SERVER, secretKeyText: created.value.secretKeyText, password: SecretBuf.from(new TextEncoder().encode(PASSWORD)),
    });
    if (!signedIn.ok) throw new Error(`enrolment failed: ${signedIn.error.code}`);
    expect(signedIn.value.folds.map((f) => f.id)).toEqual([foldId]);

    // B unlocks its stored credentials to get the sync keys, as the app would after a reload
    const unlocked = await crypto.unlock({ password: SecretBuf.from(new TextEncoder().encode(PASSWORD)), credentials: b.creds.current()! });
    if (unlocked === 'wrong_password' || unlocked.account === undefined) throw new Error('unlock failed');
    const idB: SyncIdentity = { email: 'alice@example.com', accountId: signedIn.value.accountId, server: SERVER, account: unlocked.account, publicKeys: unlocked.publicKeys! };
    b.sync.start(idB, 'done');
    await vi_waitFor(async () => (await b.sync.snapshot()).connection === 'online');
    await b.sync.syncNow();

    const sB = b.session();
    const records = async (s: NodeSession) => [...(await s.projections.listRecords(foldId)).keys()].sort();
    expect(await records(sB)).toEqual(await records(sA));
    expect((await sB.directory.get(foldId))!.name).toBe('Personal'); // the settings record arrived and named the Fold

    // --- an edit on B reaches A
    const edit = await sB.commandBus.execute(createAccountCommands().createAccountRecord, { fold: foldId, id: '00000000-0000-4000-8000-0000000000b1' as Id, kind: 'savings', name: 'Rainy day', currency: 'USD', openingBalanceMinor: 500n, openingDate: 20_260_101 as never });
    expect(edit.ok).toBe(true);
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await records(sA)).toEqual(await records(sB));
    expect((await records(sA)).length).toBeGreaterThan(2);

    // --- A removes B: B is told, and cannot sync
    const labels = createDeviceLabels(rng);
    const devices = createDeviceManager({ link: () => a.sync.link(), labels, account: idA.account, thisDevice: sA.deviceId });
    const listed = await devices.list();
    if (!listed.ok) throw new Error('list failed');
    expect(listed.value).toHaveLength(2);
    const other = listed.value.find((d) => !d.thisDevice)!;
    expect(await devices.rename(other.id, 'Tablet')).toEqual({ ok: true, value: true });
    expect((await devices.list() as { ok: true; value: Array<{ label?: string }> }).value.map((d) => d.label)).toContain('Tablet');
    expect(await devices.revoke(other.id)).toEqual({ ok: true, value: true });
    await b.sync.stop();
    b.sync.start(idB, 'done');
    await vi_waitFor(async () => (await b.sync.snapshot()).connection === 'removed');
    expect(b.events.some((e) => e.type === 'DeviceRemoved')).toBe(true);
  });
});

async function pair() {
  const { auth, crypto } = await world();
  const a = makeDevice(auth, () => undefined);
  const sessionA = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => clock.now });
  const portA = sessionPortFor(a.holder, (s) => createNodeSession({ deviceId: s.deviceId, deviceSigningKey: s.deviceSigningKey as SecretBuf }, () => clock.now));
  const pw = () => SecretBuf.from(new TextEncoder().encode(PASSWORD));
  return { auth, crypto, a, sessionA, portA, pw };
}

async function enrol(p: Awaited<ReturnType<typeof pair>>, secretKeyText: string) {
  const b = makeDevice(p.auth, () => undefined);
  const sessionB = createSession({ closeDatabase: async () => undefined, terminateWorker: () => undefined, nowMs: () => clock.now });
  const portB = sessionPortFor(b.holder, (s) => createNodeSession({ deviceId: s.deviceId, deviceSigningKey: s.deviceSigningKey as SecretBuf }, () => clock.now));
  const grants = createFoldGrantPort({ keyring: () => b.holder.session?.keyring as never, rng });
  const signedIn = await signInOnNewDevice({ relay: p.auth, enrolCrypto: p.crypto, grants, credentials: b.creds, sessionPort: portB, session: sessionB, random: rng })({
    email: 'alice@example.com', server: SERVER, secretKeyText, password: p.pw(),
  });
  if (!signedIn.ok) throw new Error(`enrolment failed: ${signedIn.error.code}`);
  const unlocked = await p.crypto.unlock({ password: p.pw(), credentials: b.creds.current()! });
  if (unlocked === 'wrong_password' || unlocked.account === undefined) throw new Error('unlock failed');
  const identity: SyncIdentity = { email: 'alice@example.com', accountId: signedIn.value.accountId, server: SERVER, account: unlocked.account, publicKeys: unlocked.publicKeys! };
  return { b, identity, foldIds: signedIn.value.folds.map((f) => f.id) };
}

const accountRecord = (fold: Id, n: number, name: string) => ({ fold, id: `00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, '0')}` as Id, kind: 'checking' as const, name, currency: 'USD', openingBalanceMinor: 0n, openingDate: 20_260_101 as never });
const view = async (s: NodeSession, fold: Id) => JSON.stringify([...(await s.projections.listRecords(fold))].map(([k, r]) => [k, [...r.fields].map(([f, e]) => [f, String(e.value)]).sort()]).sort());

describe('offline first, then together', () => {
  it('registers an account made offline, and puts its existing data on the service', async () => {
    network.up = false;
    const p = await pair();
    const created = await createAccount({ crypto: p.crypto, registration: createWebRegistration({ fetchImpl }), credentials: p.a.creds, sessionPort: p.portA, session: p.sessionA, random: rng })({
      email: 'alice@example.com', password: p.pw(), server: SERVER, discoverable: true,
    });
    if (!created.ok) throw new Error('sign-up failed');
    expect(created.value.registration).toBe('pending');
    const fold = created.value.fold.id;
    await p.a.session().commandBus.execute(createAccountCommands().createAccountRecord, accountRecord(fold, 0xa1, 'Made offline'));

    network.up = true;
    const registered = await registerExisting({ crypto: p.crypto, registration: createWebRegistration({ fetchImpl }), credentials: p.a.creds })({ password: p.pw() });
    if (!registered.ok) throw new Error(`registration failed: ${registered.error.code}`);
    expect(p.a.creds.current()!.registration).toBe('done');
    const idA: SyncIdentity = { email: 'alice@example.com', accountId: created.value.accountId, server: SERVER, account: registered.value.account, publicKeys: registered.value.publicKeys };
    p.a.sync.start(idA, 'done');
    await vi_waitFor(async () => (await p.a.sync.snapshot()).connection === 'online');
    await p.a.sync.syncNow();
    expect((await p.a.sync.snapshot()).folds[0]).toMatchObject({ state: 'synced', pendingOps: 0 });

    const { b, identity } = await enrol(p, created.value.secretKeyText);
    b.sync.start(identity, 'done');
    await vi_waitFor(async () => (await b.sync.snapshot()).connection === 'online');
    await b.sync.syncNow();
    expect(await view(b.session(), fold)).toBe(await view(p.a.session(), fold));
    expect((await b.session().directory.get(fold))!.name).toBe('Personal');
  });

  it('keeps edits made while offline, sends them once the network is back, and ends with the same data on both', async () => {
    const p = await pair();
    const created = await createAccount({ crypto: p.crypto, registration: createWebRegistration({ fetchImpl }), credentials: p.a.creds, sessionPort: p.portA, session: p.sessionA, random: rng })({
      email: 'alice@example.com', password: p.pw(), server: SERVER, discoverable: true,
    });
    if (!created.ok) throw new Error('sign-up failed');
    const fold = created.value.fold.id;
    const idA: SyncIdentity = { email: 'alice@example.com', accountId: created.value.accountId, server: SERVER, account: created.value.sync!.account, publicKeys: created.value.sync!.publicKeys };
    await p.a.session().commandBus.execute(createAccountCommands().createAccountRecord, accountRecord(fold, 0xa1, 'Shared name'));
    p.a.sync.start(idA, 'done');
    await vi_waitFor(async () => (await p.a.sync.snapshot()).connection === 'online');
    await p.a.sync.syncNow();
    const { b, identity } = await enrol(p, created.value.secretKeyText);
    b.sync.start(identity, 'done');
    await vi_waitFor(async () => (await b.sync.snapshot()).connection === 'online');
    await b.sync.syncNow();
    const [sA, sB] = [p.a.session(), b.session()];

    // both go offline and edit: disjoint fields on one account, and the very same field on another
    network.up = false;
    const accounts = createAccountCommands();
    await sA.commandBus.execute(accounts.createAccountRecord, accountRecord(fold, 0xa2, 'Only on A'));
    await sB.commandBus.execute(accounts.createAccountRecord, accountRecord(fold, 0xb2, 'Only on B'));
    clock.now += 1_000;
    await sA.commandBus.execute(accounts.updateAccount, { fold, id: '00000000-0000-4000-8000-0000000000a1' as Id, changes: { name: 'Renamed by A' } });
    clock.now += 1_000;
    await sB.commandBus.execute(accounts.updateAccount, { fold, id: '00000000-0000-4000-8000-0000000000a1' as Id, changes: { name: 'Renamed by B' } });
    await a_syncOffline(p.a.sync);
    await a_syncOffline(b.sync);
    expect((await b.sync.snapshot()).folds[0]!.pendingOps).toBeGreaterThan(0);

    network.up = true;
    for (let i = 0; i < 3; i++) {
      await p.a.sync.syncNow();
      await b.sync.syncNow();
      await vi_waitFor(async () => (await p.a.sync.snapshot()).connection === 'online' && (await b.sync.snapshot()).connection === 'online');
    }
    await p.a.sync.syncNow();
    await b.sync.syncNow();
    expect(await view(sA, fold)).toBe(await view(sB, fold));
    const names = (await sA.projections.listRecords(fold));
    const renamed = names.get('00000000-0000-4000-8000-0000000000a1' as Id)!.fields.get(2)!.value;
    expect(renamed).toBe('Renamed by B'); // the later write wins on both devices
    expect(names.has('00000000-0000-4000-8000-0000000000a2' as Id) && names.has('00000000-0000-4000-8000-0000000000b2' as Id)).toBe(true); // nothing lost
    expect((await b.sync.snapshot()).folds[0]).toMatchObject({ state: 'synced', pendingOps: 0 });
  });
});

async function a_syncOffline(sync: { syncNow(): Promise<void> }): Promise<void> {
  await sync.syncNow().catch(() => undefined);
}

async function vi_waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not reached');
}
void (null as unknown as AccountSecrets);
void ensureRemoteFolds;
void registerExisting;
void idToBytes;
void createFoldCommands;
