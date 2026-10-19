import { randomBytes } from 'node:crypto';
import { createAesGcm, createEd25519Signer, createHkdf, createRelayClient, createSharingCrypto, SecretBuf, x25519PublicKey, type RelaySession, type Send, type SignedIn } from '@cashfold/crypto';
import { encode } from '@cashfold/protocol/cbor';
import { encodeKeySet, encodeOpEnvelope } from '@cashfold/protocol';
import { opSigningBytes } from '@cashfold/protocol/wire';
import { createRelay, type Relay } from '../../src/app.js';
import type { ServerConfig } from '../../src/config.js';
import { createLogMailer } from '../../src/modules/mail/mail.js';
import type { Store } from '../../src/store/store.js';
import { randomX, testPake } from './pake.js';

export const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 0, store: 'memory', databaseUrl: '', serverSecret: randomBytes(32), registration: 'open', inviteCodes: [], mail: { kind: 'log' }, publicUrl: 'https://app.example.test',
  rates: { kind: 'disabled' }, defaultKdf: { mKib: 65_536, t: 3, p: 1 }, allowedOrigins: ['https://app.example.test'], ...over,
});

/** The parts of an injected response the tests read (the full type differs between duplicate light-my-request copies). */
export interface RawResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  readonly body: string;
  readonly rawPayload: Buffer;
}

export interface Harness {
  readonly relay: Relay;
  readonly clock: { now: number };
  readonly mail: ReturnType<typeof createLogMailer>;
  readonly send: Send;
  readonly raw: (method: string, url: string, headers?: Record<string, string>, body?: Uint8Array) => Promise<RawResponse>;
  close(): Promise<void>;
}

export async function startRelay(store: Store, over: Partial<ServerConfig> = {}, extra: { fetchRates?: (url: string) => Promise<string> } = {}): Promise<Harness> {
  const clock = { now: 1_800_000_000_000 };
  const mail = createLogMailer(() => undefined);
  const relay = await createRelay({ config: config(over), store, clock: { now: () => clock.now }, ...(over.mail?.kind === 'none' ? {} : { mail }), ...extra });
  const raw: Harness['raw'] = async (method, url, headers = {}, body) =>
    relay.app.inject({ method: method as 'GET', url, headers, ...(body !== undefined && { payload: Buffer.from(body) }), remoteAddress: headers['x-test-ip'] ?? '203.0.113.1' });
  const send: Send = async (req) => {
    const res = await raw(req.method, req.path, req.headers, req.body);
    return { status: res.statusCode, headers: res.headers as Record<string, string>, body: new Uint8Array(res.rawPayload) };
  };
  return { relay, clock, mail, send, raw, close: () => relay.close() };
}

const signer = createEd25519Signer();
export const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

export interface TestDevice {
  readonly devId: Buffer;
  readonly sigPk: Uint8Array;
  readonly sigSk: SecretBuf;
}
export const newDevice = async (): Promise<TestDevice> => {
  const pair = await signer.generate(rng);
  return { devId: randomBytes(16), sigPk: pair.publicKey, sigSk: pair.secretKey };
};

export interface TestAccount {
  readonly accountId: string;
  readonly email: string;
  readonly x: Buffer;
  readonly device: TestDevice;
  readonly authSalt: Buffer;
  /** The account's own key pairs, present when it was registered with a real key set (`keys: true`). */
  readonly keys?: { readonly encPk: Uint8Array; readonly encSk: SecretBuf; readonly sigPk: Uint8Array; readonly sigSk: SecretBuf; readonly bundleSig: Uint8Array };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newAccountId = (): string => Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** Registers an account with a random SRP secret, as a client that has already derived it would. */
export async function register(h: Harness, over: { email?: string; accountId?: string; invite?: string; keys?: boolean; discoverable?: boolean } = {}): Promise<TestAccount> {
  const pake = await testPake();
  const x = randomX();
  const device = await newDevice();
  const authSalt = randomBytes(16);
  const accountId = over.accountId ?? newAccountId();
  const email = over.email ?? `${accountId.toLowerCase()}@example.com`;
  // A real key set (public keys a log entry can be checked against) when the test is about sharing; random bytes otherwise.
  let keys: TestAccount['keys'];
  let keyset: Uint8Array = randomBytes(300);
  let bundleSig: Uint8Array | undefined;
  const encSalt = randomBytes(16);
  if (over.keys === true) {
    const encSk = SecretBuf.from(rng.bytes(32));
    const encPk = x25519PublicKey(encSk);
    const sig = await signer.generate(rng);
    const bundle = await createSharingCrypto({ rng }).signBundle({ accountId, encPk, sigSk: sig.secretKey });
    bundleSig = bundle.selfSig;
    keys = { encPk, encSk, sigPk: sig.publicKey, sigSk: sig.secretKey, bundleSig };
    keyset = encodeKeySet({
      v: 1, uuid: randomBytes(16), enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM', pk: encPk, sk_ct: randomBytes(60) }, sig: { alg: 'Ed25519', pk: sig.publicKey, sk_ct: randomBytes(60) },
      kdf: { kdf: 'argon2id', m_kib: 65_536, t: 3, p: 1, v: 19, enc_salt: encSalt }, encrypted_by: 'mp',
    });
  }
  const body = {
    account_id: accountId, email, auth_salt: authSalt, kdf: { kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n, enc_salt: encSalt },
    srp_verifier: pake.verifier(SecretBuf.from(x)), keyset, device: { dev_id: device.devId, sig_pk: device.sigPk },
    ...(bundleSig !== undefined && { bundle_sig: bundleSig }), ...(over.discoverable !== undefined && { discoverable: over.discoverable }),
  };
  const res = await h.raw('POST', '/accounts', { 'content-type': 'application/cbor', ...(over.invite && { 'x-invite-code': over.invite }) }, encode(body as never));
  if (res.statusCode !== 201) throw new Error(`registration failed: ${res.statusCode}`);
  return { accountId, email, x, device, authSalt, ...(keys !== undefined && { keys }) };
}

export async function signIn(h: Harness, a: TestAccount, device: TestDevice = a.device, x: Buffer = a.x, credential?: 'recovery'): Promise<SignedIn> {
  const pake = await testPake();
  const client = createRelayClient({ send: h.send, pake, aead: createAesGcm(), hkdf: createHkdf(), nowMs: () => h.clock.now });
  return client.signIn({ email: a.email, deviceId: device.devId, deriveX: async () => SecretBuf.from(x), ...(credential !== undefined && { credential }) });
}

export async function signedOp(foldId: Uint8Array, device: TestDevice, seq: bigint, over: { blob?: Uint8Array; opId?: Uint8Array; key?: SecretBuf } = {}): Promise<Uint8Array> {
  const e = {
    v: 1 as const, fold: foldId, op: over.opId ?? randomBytes(16), rec: randomBytes(16), dev: device.devId, seq, hlc: { wallMs: 1_800_000_000_000 + Number(seq), ctr: 0 },
    epoch: 1, schema: 1, blob: over.blob ?? randomBytes(120),
  };
  const sig = await signer.sign(over.key ?? device.sigSk, opSigningBytes(e));
  return encodeOpEnvelope({ ...e, sig });
}

export type Session = RelaySession;
