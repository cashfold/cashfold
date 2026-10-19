import { createAesGcm, createHkdf, createRelayClient, KdfBelowFloor, RelayError, SecretBuf, type KdfWire, type Pake, type RelaySession, type Send } from '@cashfold/crypto';
import { idToBytes, type KdfOffer, type RelayAuthPort, type RelayErrorKind, type RelayLink, type RelayReply } from '@cashfold/core';
import { createFetchSend, type FetchLike } from './relay-http';

// The relay as the app's core sees it: SRP sign-in, then sealed requests that answer with a result instead of throwing.

const KIND: Record<string, RelayErrorKind> = {
  rejected: 'rejected', revoked: 'revoked', rate_limited: 'rate_limited', offline: 'offline', gone: 'gone', forbidden: 'forbidden',
  not_found: 'not_found', conflict: 'conflict', protocol: 'protocol', server: 'protocol',
};

export function relayKind(e: RelayError): RelayErrorKind {
  return e.status === 400 ? 'bad_request' : (KIND[e.kind] ?? 'protocol');
}

/** A signed-in session that can also open the Fold stream. */
export interface WebRelayLink extends RelayLink {
  readonly session: RelaySession;
  readonly server: string;
  /** Runs `fn` while no other request on this session is being made, so frame counters reach the service in order. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

const offerOf = (k: KdfWire): KdfOffer =>
  k.kdf === 'argon2id'
    ? { kdf: 'argon2id', mKib: k.mKib ?? 0, t: k.t ?? 0, p: k.p ?? 0, encSalt: k.encSalt }
    : { kdf: 'pbkdf2-hmac-sha256', iterations: k.iter ?? 0, encSalt: k.encSalt };

export function createWebLink(session: RelaySession, freshProof: Uint8Array, server: string): WebRelayLink {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
  return {
    session, server, freshProof, exclusive,
    request: (method, path, body) =>
      exclusive(async (): Promise<RelayReply> => {
        try {
          const r = await session.request(method, path, body);
          return { ok: true, status: r.status, body: r.body };
        } catch (e) {
          if (e instanceof RelayError) return { ok: false, kind: relayKind(e), status: e.status, ...(e.retryAfterSec !== undefined && { retryAfterS: e.retryAfterSec }) };
          return { ok: false, kind: 'protocol' };
        }
      }),
    close: () => session.close(),
  };
}

export function createWebRelayAuth(deps: { pake: () => Promise<Pake>; send?: (server: string) => Send; fetchImpl?: FetchLike; nowMs?: () => number }): RelayAuthPort {
  return {
    async signIn({ server, email, deviceId, deriveX }) {
      const send = deps.send?.(server) ?? createFetchSend(server, deps.fetchImpl);
      let pake: Pake;
      try {
        pake = await deps.pake();
      } catch {
        return { ok: false, kind: 'protocol' };
      }
      const client = createRelayClient({ send, pake, aead: createAesGcm(), hkdf: createHkdf(), ...(deps.nowMs && { nowMs: deps.nowMs }) });
      try {
        const signed = await client.signIn({
          email, deviceId: idToBytes(deviceId),
          deriveX: async (authSalt, kdf) => (await deriveX({ authSalt, kdf: offerOf(kdf) })) as SecretBuf,
        });
        return { ok: true, accountId: signed.accountId, link: createWebLink(signed.session, signed.freshProof, server) };
      } catch (e) {
        if (e instanceof KdfBelowFloor) return { ok: false, kind: 'kdf_below_floor' };
        if (e instanceof RelayError) return { ok: false, kind: relayKind(e) };
        throw e;
      }
    },
  };
}
