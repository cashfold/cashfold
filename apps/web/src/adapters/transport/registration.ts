import type { RegistrationPayload, RegistrationPort, RegistrationResult } from '@cashfold/core';
import { idToBytes } from '@cashfold/core';
import { encode } from '@cashfold/protocol/cbor';
import { createFetchSend, type FetchLike } from './relay-http';

// POST /accounts (public route: nothing is signed in yet). What the service receives is the SRP verifier, the encrypted key
// set, the salts, the device's public signing key and the email address: nothing that opens anything (FR-011).

export function bodyOf(p: RegistrationPayload): Uint8Array {
  if (p.srpVerifier === undefined || p.authSalt === undefined || p.kdf === undefined) throw new Error('registration needs the sign-in material');
  return encode({
    account_id: p.accountId, email: p.email, auth_salt: p.authSalt,
    kdf: { kdf: 'argon2id', m_kib: BigInt(p.kdf.mKib), t: BigInt(p.kdf.t), p: BigInt(p.kdf.p), enc_salt: p.kdf.encSalt },
    srp_verifier: p.srpVerifier, keyset: p.keySet, discoverable: p.discoverable, ...(p.bundleSig !== undefined && { bundle_sig: p.bundleSig }), device: { dev_id: idToBytes(p.deviceId), sig_pk: p.deviceSigPk },
  } as never);
}

export function createWebRegistration(deps: { fetchImpl?: FetchLike } = {}): RegistrationPort {
  return {
    async register(payload, options): Promise<RegistrationResult> {
      if (payload.srpVerifier === undefined) return { ok: false, reason: 'offline' }; // this build cannot register yet: try again later
      const send = createFetchSend(payload.server, deps.fetchImpl);
      try {
        const res = await send({
          method: 'POST', path: '/accounts', body: bodyOf(payload),
          headers: { 'content-type': 'application/cbor', ...(options?.inviteCode !== undefined && { 'x-invite-code': options.inviteCode }) },
        });
        if (res.status === 201) return { ok: true };
        if (res.status === 409) return { ok: false, reason: 'email_taken' };
        if (res.status === 403) return { ok: false, reason: 'invite_required' };
        if (res.status === 429) return { ok: false, reason: 'rate_limited' };
        return { ok: false, reason: res.status >= 500 ? 'offline' : 'rejected' };
      } catch {
        return { ok: false, reason: 'offline' };
      }
    },
  };
}
