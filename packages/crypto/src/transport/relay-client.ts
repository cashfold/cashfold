import { decode, encode } from '@cashfold/protocol/cbor';
import type { Pake } from '../pake/srp-client';
import type { Aead, Hkdf, KdfParams } from '../ports/index';
import { KdfBelowFloor } from '../ports/index';
import { SecretBuf } from '../secret-buf';
import { createFrameEndpoint, deriveTransportKeys, FrameError, type FrameEndpoint } from './frame';

// The client's side of the relay protocol: SRP sign-in, then framed requests (contracts/auth-srp.md, sync-api.openapi.yaml).
// It knows nothing about browsers or about money: `send` is whatever moves bytes (fetch in the app, an in-process server in
// tests). Requests are sent one at a time, because frame counters must arrive in order.

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path with query, as the server routes it. */
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body?: Uint8Array;
}
export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
}
export type Send = (request: HttpRequest) => Promise<HttpResponse>;

export type RelayErrorKind = 'rejected' | 'revoked' | 'rate_limited' | 'offline' | 'protocol' | 'gone' | 'forbidden' | 'not_found' | 'conflict' | 'server';

export class RelayError extends Error {
  constructor(readonly kind: RelayErrorKind, readonly status = 0, readonly retryAfterSec?: number) {
    super(`relay: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'RelayError';
  }
}

export interface KdfWire {
  readonly kdf: 'argon2id' | 'pbkdf2-hmac-sha256';
  readonly mKib?: number;
  readonly t?: number;
  readonly p?: number;
  readonly iter?: number;
  readonly encSalt: Uint8Array;
}

export interface SignedIn {
  readonly accountId: string;
  readonly authSalt: Uint8Array;
  readonly kdf: KdfWire;
  readonly session: RelaySession;
  /** This sign-in's client proof; account deletion must present it while the sign-in is fresh. */
  readonly freshProof: Uint8Array;
}

export interface Reply {
  readonly status: number;
  /** The decoded inner body (CBOR), or null. */
  readonly body: unknown;
}

export interface RelaySession {
  readonly sessionId: Uint8Array;
  request(method: HttpRequest['method'], path: string, body?: unknown): Promise<Reply>;
  /** A frame proving this session, for a request the caller sends itself (the WebSocket stream). */
  sealRequest(method: 'GET', path: string): Promise<Uint8Array>;
  readonly closed: boolean;
  close(): void;
}

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/** Server-supplied key-derivation parameters below the floors abort sign-in (FR-019). */
export function checkKdfFloors(k: KdfWire): KdfParams {
  if (k.kdf === 'argon2id') {
    const [m, t, p] = [k.mKib ?? 0, k.t ?? 0, k.p ?? 0];
    if (m < 32_768 || t < 2 || p < 1) throw new KdfBelowFloor(`argon2id m=${m} t=${t} p=${p}`);
    return { kdf: 'argon2id', mKib: m, t, p };
  }
  const iterations = k.iter ?? 0;
  if (iterations < 600_000) throw new KdfBelowFloor(`pbkdf2 iter=${iterations}`);
  return { kdf: 'pbkdf2-hmac-sha256', iterations };
}

const asNumber = (v: unknown): number | undefined => (typeof v === 'bigint' ? Number(v) : undefined);
const asBytes = (v: unknown): Uint8Array | undefined => (v instanceof Uint8Array ? v : undefined);

function readKdf(v: unknown): KdfWire | undefined {
  const m = v instanceof Map ? (v as Map<string, unknown>) : undefined;
  const kdf = m?.get('kdf');
  const encSalt = asBytes(m?.get('enc_salt'));
  if (m === undefined || (kdf !== 'argon2id' && kdf !== 'pbkdf2-hmac-sha256') || encSalt?.length !== 16) return undefined;
  const mKib = asNumber(m.get('m_kib'));
  const t = asNumber(m.get('t'));
  const p = asNumber(m.get('p'));
  const iter = asNumber(m.get('iter'));
  return { kdf, ...(mKib !== undefined && { mKib }), ...(t !== undefined && { t }), ...(p !== undefined && { p }), ...(iter !== undefined && { iter }), encSalt };
}

function errorCode(body: Uint8Array): string | undefined {
  try {
    const v = decode(body);
    const code = v instanceof Map ? (v as Map<string, unknown>).get('error') : undefined;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function statusKind(status: number): RelayErrorKind {
  return status === 410 ? 'gone' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 401 ? 'rejected' : status === 429 ? 'rate_limited' : status >= 500 ? 'server' : 'protocol';
}

export function createRelayClient({ send, pake, aead, hkdf, nowMs = Date.now }: { send: Send; pake: Pake; aead: Aead; hkdf: Hkdf; nowMs?: () => number }) {
  async function plain(method: HttpRequest['method'], path: string, body: unknown): Promise<Reply> {
    let res: HttpResponse;
    try {
      res = await send({ method, path, headers: { 'content-type': 'application/cbor' }, ...(body !== undefined && { body: encode(body as never) }) });
    } catch {
      throw new RelayError('offline');
    }
    const retry = Number(res.headers['retry-after']);
    if (res.status >= 400) {
      // The one named refusal on the public routes: the proof was right but this device was removed (see auth.service.ts).
      if (res.status === 403 && path === '/auth/proof-m1' && errorCode(res.body) === 'device_revoked') throw new RelayError('revoked', 403);
      throw new RelayError(statusKind(res.status), res.status, Number.isFinite(retry) ? retry : undefined);
    }
    let decoded: unknown = null;
    if (res.body.length > 0) {
      try {
        decoded = decode(res.body);
      } catch {
        throw new RelayError('protocol', res.status);
      }
    }
    return { status: res.status, body: decoded };
  }

  return {
    /** A public call before sign-in: registration, e-mail confirmation. */
    plain,

    /**
     * SRP-6a sign-in. `deriveX` gets the salt and key-derivation parameters the server sent (already checked against the
     * floors) and returns this device's SRP-x; it is wiped here as soon as the exchange needs it no more.
     */
    async signIn({ email, deviceId, deriveX }: { email: string; deviceId: Uint8Array; deriveX: (authSalt: Uint8Array, kdf: KdfWire) => Promise<SecretBuf> }): Promise<SignedIn> {
      const hello = (await plain('POST', '/auth/hello', { email, device_id: deviceId })).body;
      const h = hello instanceof Map ? (hello as Map<string, unknown>) : undefined;
      const [accountId, authSalt, kdf, sessionId] = [h?.get('account_id'), asBytes(h?.get('auth_salt')), readKdf(h?.get('kdf')), asBytes(h?.get('session_id'))];
      if (typeof accountId !== 'string' || authSalt?.length !== 16 || kdf === undefined || sessionId?.length !== 16) throw new RelayError('protocol');
      checkKdfFloors(kdf);

      const x = await deriveX(authSalt, kdf);
      const exchange = pake.start(x);
      x.wipe();
      let B: Uint8Array | undefined;
      try {
        const a = (await plain('POST', '/auth/proof-a', { session_id: sessionId, A: exchange.A })).body;
        B = asBytes(a instanceof Map ? a.get('B') : undefined);
      } catch (e) {
        exchange.wipe();
        throw e;
      }
      if (B === undefined) {
        exchange.wipe();
        throw new RelayError('protocol');
      }
      let result;
      try {
        result = exchange.respond({ accountId, authSalt, B });
      } catch {
        throw new RelayError('rejected');
      }
      const m = (await plain('POST', '/auth/proof-m1', { session_id: sessionId, M1: result.M1 }).catch((e: unknown) => {
        result.key.wipe();
        throw e;
      })).body;
      const M2 = asBytes(m instanceof Map ? m.get('M2') : undefined);
      if (M2 === undefined || !result.verify(M2)) {
        result.key.wipe();
        throw new RelayError('rejected'); // a server that cannot prove it knows the verifier is not trusted
      }
      const keys = await deriveTransportKeys({ hkdf, key: result.key, transcript: result.transcript });
      result.key.wipe();
      const endpoint: FrameEndpoint = createFrameEndpoint({ role: 'client', sessionId, keys, aead, nowMs });

      let queue: Promise<unknown> = Promise.resolve();
      const session: RelaySession = {
        sessionId,
        get closed() {
          return endpoint.closed;
        },
        close: () => endpoint.close(),
        sealRequest: (method, path) => endpoint.seal(encode({ m: method, p: path, b: null } as never)),
        request(method, path, body) {
          const run = async (): Promise<Reply> => {
            let frame: Uint8Array;
            try {
              frame = await endpoint.seal(encode({ m: method, p: path, b: body === undefined ? null : body } as never));
            } catch (e) {
              // A session that ended (closed here, expired, or ended by a bad frame) cannot send: signing in again is the way on.
              if (e instanceof FrameError) throw new RelayError('rejected', 401);
              throw e;
            }
            const headers: Record<string, string> = { 'x-cashfold-session': b64url(sessionId), 'content-type': 'application/cbor' };
            const hasBody = method === 'POST' || method === 'PUT';
            if (!hasBody) headers['x-cashfold-frame'] = b64url(frame);
            let res: HttpResponse;
            try {
              res = await send({ method, path, headers, ...(hasBody && { body: frame }) });
            } catch {
              throw new RelayError('offline');
            }
            const retry = Number(res.headers['retry-after']);
            if (res.body.length === 0) throw new RelayError(res.status >= 400 ? statusKind(res.status) : 'protocol', res.status);
            let inner: Uint8Array;
            try {
              inner = await endpoint.open(res.body);
            } catch (e) {
              // An unsealed answer is a refusal before the frame was accepted (session unknown or ended): just a status.
              if (e instanceof FrameError && res.status >= 400) throw new RelayError(statusKind(res.status), res.status, Number.isFinite(retry) ? retry : undefined);
              throw e instanceof FrameError ? new RelayError('protocol', res.status) : e;
            }
            const decoded = decode(inner);
            const fields = decoded instanceof Map ? (decoded as Map<string, unknown>) : undefined;
            const status = asNumber(fields?.get('s'));
            if (status === undefined) throw new RelayError('protocol', res.status);
            if (status >= 400) throw new RelayError(statusKind(status), status);
            return { status, body: fields?.get('b') ?? null };
          };
          const next = queue.then(run, run);
          queue = next.catch(() => undefined);
          return next;
        },
      };
      return { accountId, authSalt, kdf, session, freshProof: result.M1 };
    },
  };
}

export type RelayClient = ReturnType<typeof createRelayClient>;
