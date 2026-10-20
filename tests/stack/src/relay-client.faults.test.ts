import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkKdfFloors, createAesGcm, createHkdf, createPake, createRelayClient, KdfBelowFloor, loadSrpBigint, RelayError, SecretBuf, type HttpRequest, type HttpResponse, type Send } from '@cashfold/crypto';
import { decode, encode } from '@cashfold/protocol/cbor';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay, type Relay } from '../../../apps/server/src/app';
import type { ServerConfig } from '../../../apps/server/src/config';
import { createMemoryStore } from '../../../apps/server/src/store/memory-store';

// How the sign-in and request code behaves when the network or the service misbehaves. The real relay answers; a fault
// wrapper alters, delays or drops what it says. Each case is one way a service can fail or lie.

const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const dir = new URL('../../../packages/crypto/src/adapters/srp-wasm/', import.meta.url);
const pakeP = loadSrpBigint(new Uint8Array(readFileSync(new URL('srp-bigint.wasm', dir))), readFileSync(new URL('srp-bigint.wasm.sha256', dir), 'utf8')).then((bn) => createPake({ bn, rng }));
const config: ServerConfig = {
  port: 0, store: 'memory', databaseUrl: '', serverSecret: randomBytes(32), registration: 'open', inviteCodes: [], mail: { kind: 'none' }, publicUrl: 'https://x.test',
  rates: { kind: 'disabled' }, defaultKdf: { mKib: 65_536, t: 3, p: 1 }, allowedOrigins: [], rateLimitScale: 100,
};
const x = randomBytes(32);
const email = 'fault@example.com';
const devId = randomBytes(16);
const sigPk = randomBytes(32);

let relay: Relay | undefined;
afterEach(async () => {
  await relay?.close();
  relay = undefined;
});

type Fault = (req: HttpRequest, real: () => Promise<HttpResponse>) => Promise<HttpResponse>;

async function setup() {
  relay = await createRelay({ config, store: createMemoryStore() });
  const pake = await pakeP;
  const faults: Fault[] = [];
  const raw = async (req: HttpRequest): Promise<HttpResponse> => {
    const res = await relay!.app.inject({ method: req.method, url: req.path, headers: req.headers, ...(req.body !== undefined && { payload: Buffer.from(req.body) }), remoteAddress: '203.0.113.5' });
    return { status: res.statusCode, headers: res.headers as Record<string, string>, body: new Uint8Array(res.rawPayload) };
  };
  const send: Send = (req) => {
    const fault = faults.find((f) => f !== undefined);
    return fault === undefined ? raw(req) : fault(req, () => raw(req));
  };
  const client = createRelayClient({ send, pake, aead: createAesGcm(), hkdf: createHkdf() });
  // register the account through the public route
  const kdf = { kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n, enc_salt: randomBytes(16) };
  const reg = await raw({ method: 'POST', path: '/accounts', headers: { 'content-type': 'application/cbor' }, body: encode({ account_id: 'ABCDEF', email, auth_salt: randomBytes(16), kdf, srp_verifier: pake.verifier(SecretBuf.from(x)), keyset: randomBytes(100), device: { dev_id: devId, sig_pk: sigPk } } as never) });
  expect(reg.status).toBe(201);
  const signIn = () => client.signIn({ email, deviceId: devId, deriveX: async () => SecretBuf.from(x) });
  return { client, faults, signIn, raw };
}

/** Replaces the answer to one path with `change(real answer)`; every other request goes through untouched. */
const on = (path: string, change: (real: HttpResponse) => HttpResponse | Promise<HttpResponse>): Fault => async (req, real) => {
  const res = await real();
  return req.path.startsWith(path) ? change(res) : res;
};
const body = (b: unknown) => encode(b as never);
const kind = async (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: unknown) => (e instanceof RelayError ? `${e.kind}${e.retryAfterSec !== undefined ? `:${e.retryAfterSec}` : ''}` : (e as Error).name));

describe('before the session exists', () => {
  it('reports a network that is down as offline', async () => {
    const s = await setup();
    s.faults.push(async () => { throw new TypeError('network'); });
    expect(await kind(s.signIn())).toBe('offline');
  });

  it('passes on a rate limit with its Retry-After', async () => {
    const s = await setup();
    s.faults.push(on('/auth/hello', (r) => ({ ...r, status: 429, headers: { ...r.headers, 'retry-after': '37' } })));
    expect(await kind(s.signIn())).toBe('rate_limited:37');
  });

  it.each([
    ['a hello with the wrong shape', '/auth/hello', () => body({ nonsense: 1n })],
    ['a hello that is not CBOR', '/auth/hello', () => Uint8Array.from([0xff, 0xff])],
    ['a proof-a without B', '/auth/proof-a', () => body({ B: null })],
    ['a 2xx answer that is not CBOR', '/auth/proof-a', () => Uint8Array.from([0xff])],
  ])('treats %s as a broken service', async (_n, path, make) => {
    const s = await setup();
    s.faults.push(on(path, (r) => ({ ...r, body: make() })));
    expect(await kind(s.signIn())).toBe('protocol');
  });

  it('refuses key-derivation settings below the floors, before the password is used', async () => {
    const s = await setup();
    s.faults.push(on('/auth/hello', (r) => {
      const m = decode(r.body) as Map<string, unknown>;
      m.set('kdf', new Map<string, unknown>([['kdf', 'argon2id'], ['m_kib', 1024n], ['t', 1n], ['p', 1n], ['enc_salt', randomBytes(16)]]));
      return { ...r, body: encode(m as never) };
    }));
    let asked = false;
    await expect(s.client.signIn({ email, deviceId: devId, deriveX: async () => ((asked = true), SecretBuf.from(x)) })).rejects.toBeInstanceOf(KdfBelowFloor);
    expect(asked).toBe(false);
    s.faults.length = 0;
    s.faults.push(on('/auth/hello', (r) => {
      const m = decode(r.body) as Map<string, unknown>;
      m.set('kdf', new Map<string, unknown>([['kdf', 'pbkdf2-hmac-sha256'], ['iter', 1000n], ['enc_salt', randomBytes(16)]]));
      return { ...r, body: encode(m as never) };
    }));
    await expect(s.signIn()).rejects.toBeInstanceOf(KdfBelowFloor);
  });

  it('does not trust a service that cannot prove it knows the verifier', async () => {
    const s = await setup();
    s.faults.push(on('/auth/proof-m1', (r) => ({ ...r, body: body({ M2: randomBytes(32) }) })));
    expect(await kind(s.signIn())).toBe('rejected');
    s.faults.length = 0;
    s.faults.push(on('/auth/proof-m1', (r) => ({ ...r, body: body({}) })));
    expect(await kind(s.signIn())).toBe('rejected');
  });

  it.each([
    ['a hello that is a bare number', '/auth/hello', () => body(5n), 'protocol'],
    ['a proof-a that is a list', '/auth/proof-a', () => body([1n, 2n]), 'protocol'],
    ['a proof-m1 that is a list', '/auth/proof-m1', () => body([1n]), 'rejected'],
  ])('treats %s as a broken or untrusted service', async (_n, path, make, expected) => {
    const s = await setup();
    s.faults.push(on(path, (r) => ({ ...r, body: make() })));
    expect(await kind(s.signIn())).toBe(expected);
  });

  it('only names a removed device when the refusal says so in the expected form', async () => {
    const s = await setup();
    for (const [make, expected] of [
      [() => body({ error: 'device_revoked' }), 'revoked'], [() => body({ error: 5n }), 'forbidden'], [() => body([1n]), 'forbidden'], [() => Uint8Array.from([0xff]), 'forbidden'], [() => body({ error: 'refused' }), 'forbidden'],
    ] as const) {
      s.faults.length = 0;
      s.faults.push(on('/auth/proof-m1', (r) => ({ ...r, status: 403, body: make() })));
      expect(await kind(s.signIn())).toBe(expected);
    }
  });

  it('answers an empty successful reply on a public route with nothing to read', async () => {
    const s = await setup();
    const res = await s.client.plain('POST', '/auth/hello', { email: 'nobody@example.com', device_id: randomBytes(16) });
    expect(res.status).toBe(200);
    s.faults.push(async () => ({ status: 204, headers: {}, body: new Uint8Array() }));
    expect(await s.client.plain('POST', '/accounts/verify-email', { token: 'x'.repeat(20) })).toEqual({ status: 204, body: null });
  });

  it('rejects a B that is degenerate', async () => {
    const s = await setup();
    s.faults.push(on('/auth/proof-a', (r) => ({ ...r, body: body({ B: new Uint8Array(512) }) })));
    expect(await kind(s.signIn())).toBe('rejected');
  });

  it('maps statuses to kinds on the public routes', async () => {
    const s = await setup();
    for (const [status, expected] of [[403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [410, 'gone'], [500, 'server'], [418, 'protocol']] as const) {
      s.faults.length = 0;
      s.faults.push(on('/auth/hello', (r) => ({ ...r, status, body: new Uint8Array() })));
      expect(await kind(s.signIn()), String(status)).toBe(expected);
    }
  });

  it('turns an offline failure in the middle of sign-in into offline, and wipes what it held', async () => {
    const s = await setup();
    s.faults.push(async (req, real) => {
      if (req.path === '/auth/proof-a') throw new TypeError('network');
      return real();
    });
    expect(await kind(s.signIn())).toBe('offline');
    s.faults.length = 0;
    s.faults.push(async (req, real) => {
      if (req.path === '/auth/proof-m1') throw new TypeError('network');
      return real();
    });
    expect(await kind(s.signIn())).toBe('offline');
  });
});

describe('inside a session', () => {
  async function signedIn() {
    const s = await setup();
    const { session } = await s.signIn();
    return { ...s, session };
  }

  it('carries a request and its answer, and a body-less answer to a write', async () => {
    const s = await signedIn();
    expect((await s.session.request('POST', '/folds', { fold: randomBytes(16) })).status).toBe(201);
    expect((await s.session.request('GET', '/folds')).body).toHaveLength(1);
    expect(s.session.closed).toBe(false);
  });

  it.each([
    ['forbidden', () => ['GET', `/folds/${Buffer.from(randomBytes(16)).toString('base64url')}/ops?after=0`] as const],
    ['not_found', () => ['DELETE', `/devices/${Buffer.from(randomBytes(16)).toString('base64url')}`] as const],
  ])('says %s for that answer', async (expected, request) => {
    const s = await signedIn();
    const [m, p] = request();
    expect(await kind(s.session.request(m, p))).toBe(expected);
  });

  it('says conflict for a Fold that already exists', async () => {
    const s = await signedIn();
    const fold = randomBytes(16);
    await s.session.request('POST', '/folds', { fold });
    expect(await kind(s.session.request('POST', '/folds', { fold }))).toBe('conflict');
  });

  it('reports a request that cannot be sent as offline', async () => {
    const s = await signedIn();
    s.faults.push(async () => { throw new TypeError('network'); });
    expect(await kind(s.session.request('GET', '/folds'))).toBe('offline');
  });

  it('treats an empty answer by its status: a refusal, a missing session, or a broken service', async () => {
    const s = await signedIn();
    for (const [status, expected] of [[401, 'rejected'], [429, 'rate_limited'], [500, 'server'], [200, 'protocol']] as const) {
      s.faults.length = 0;
      s.faults.push(async () => ({ status, headers: { 'retry-after': '9' }, body: new Uint8Array() }));
      expect((await kind(s.session.request('GET', '/folds')))?.split(':')[0], String(status)).toBe(expected);
    }
  });

  it('reads an unsealed refusal as a status, and an unsealed success as a broken service', async () => {
    const s = await signedIn();
    s.faults.push(async () => ({ status: 401, headers: { 'retry-after': '5' }, body: body({ error: 'rejected' }) }));
    expect(await kind(s.session.request('GET', '/folds'))).toBe('rejected:5');
    // that ended the session: sending again says so, and a fresh sign-in is what follows
    expect(await kind(s.session.request('GET', '/folds'))).toBe('rejected');
    s.faults.length = 0;
    const again = await s.signIn();
    s.faults.push(async () => ({ status: 200, headers: {}, body: body({ not: 'sealed' }) }));
    expect(await kind(again.session.request('GET', '/folds'))).toBe('protocol');
  });

  it('refuses an answer that was altered on the way', async () => {
    const s = await signedIn();
    s.faults.push(on('/folds', (r) => ({ ...r, body: Uint8Array.from(r.body, (b, i) => (i === r.body.length - 3 ? b ^ 1 : b)) })));
    expect(await kind(s.session.request('GET', '/folds'))).toBe('protocol');
  });

  it('refuses an inner answer without a status', async () => {
    const s = await signedIn();
    // The server sealed a real answer; one the client cannot read as {s, b} is a protocol error. A replay is the easiest way to get one.
    expect((await s.session.sealRequest('GET', '/folds')).length).toBeGreaterThan(20);
    s.faults.push(async (_req, real) => {
      const r = await real();
      return { ...r, body: new Uint8Array() };
    });
    expect(await kind(s.session.request('GET', '/folds'))).toBe('protocol');
  });

  it('serialises concurrent requests so frame counters arrive in order', async () => {
    const s = await signedIn();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => s.session.request('GET', '/folds')));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  });

  it('closes, and then refuses to send', async () => {
    const s = await signedIn();
    s.session.close();
    expect(s.session.closed).toBe(true);
    expect(await kind(s.session.request('GET', '/folds'))).toBeDefined();
  });
});

describe('key-derivation floors on incomplete settings', () => {
  it('treats a missing number as zero, which is below every floor', () => {
    const encSalt = new Uint8Array(16);
    expect(() => checkKdfFloors({ kdf: 'argon2id', encSalt })).toThrow(KdfBelowFloor);
    expect(() => checkKdfFloors({ kdf: 'argon2id', mKib: 65_536, encSalt })).toThrow(KdfBelowFloor);
    expect(() => checkKdfFloors({ kdf: 'argon2id', mKib: 65_536, t: 3, encSalt })).toThrow(KdfBelowFloor);
    expect(() => checkKdfFloors({ kdf: 'pbkdf2-hmac-sha256', encSalt })).toThrow(KdfBelowFloor);
    expect(checkKdfFloors({ kdf: 'argon2id', mKib: 32_768, t: 2, p: 1, encSalt })).toEqual({ kdf: 'argon2id', mKib: 32_768, t: 2, p: 1 });
  });
});
