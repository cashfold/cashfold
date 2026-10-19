import { createHash, randomBytes } from 'node:crypto';
import { emailMac } from '../../common/crypto-util.js';
import type { Clock, RateLimiter } from '../../common/rate-limit.js';
import { kdfToRecord, type KdfWireValue } from '../../common/wire.js';
import type { ServerConfig } from '../../config.js';
import type { Store } from '../../store/store.js';
import { AuthError } from '../auth/auth.service.js';
import type { SessionStore } from '../auth/sessions.js';
import type { Mailer } from '../mail/mail.js';
import { verificationMessage } from '../mail/mail.js';
import { keysFromKeyset, verifyBundleSignature } from '../membership/bundle.js';

export type Outcome<T = void> = ({ readonly ok: true } & (T extends void ? unknown : { readonly value: T })) | { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 410; readonly code: string };

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = 5 * 60 * 1000;

export interface RegistrationInput {
  readonly accountId: string;
  readonly email: string;
  readonly authSalt: Uint8Array;
  readonly kdf: KdfWireValue;
  readonly srpVerifier: Uint8Array;
  readonly keyset: Uint8Array;
  readonly device: { readonly devId: Uint8Array; readonly sigPk: Uint8Array; readonly labelCt?: Uint8Array | undefined };
  readonly discoverable: boolean;
  readonly bundleSig?: Uint8Array | undefined;
  readonly invite?: string | undefined;
}

export function createAccountsService(deps: {
  store: Store; config: ServerConfig; sessions: SessionStore; mail: Mailer; clock: Clock; limiter: RateLimiter;
}) {
  const { store, config, sessions, mail, clock, limiter } = deps;
  const limit = (key: string, max: number, windowMs: number): void => {
    const d = limiter.hit(key, max, windowMs);
    if (!d.allowed) throw new AuthError('rate_limited', d.retryAfterSec);
  };

  async function sendVerification(accountId: string, email: string): Promise<void> {
    if (!mail.enabled) return;
    const token = randomBytes(32);
    await store.emailVerification.put(accountId, createHash('sha256').update(token).digest(), clock.now() + TOKEN_TTL_MS);
    await mail.send(verificationMessage(email, `${config.publicUrl}/verify/#token=${token.toString('base64url')}`));
  }

  return {
    verificationEnabled: mail.enabled,

    async register(input: RegistrationInput, ip: string): Promise<Outcome> {
      limit(`register:ip:${ip}`, 10, 3_600_000);
      if (config.registration === 'invite' && (input.invite === undefined || !config.inviteCodes.includes(input.invite))) return { ok: false, status: 403, code: 'invite_required' };
      if (input.bundleSig !== undefined) {
        // A bundle signature that does not match the key set it came with is refused, so the relay never hands out a bad one.
        const keys = keysFromKeyset(input.keyset);
        if (keys === undefined || !verifyBundleSignature(input.accountId, keys.encPk, keys.sigPk, input.bundleSig)) return { ok: false, status: 400, code: 'rejected' };
      }
      const made = await store.accounts.create({
        accountId: input.accountId, emailHmac: emailMac(config.serverSecret, input.email), email: input.email.trim().toLowerCase(), authSalt: input.authSalt,
        kdf: kdfToRecord(input.kdf), srpVerifier: input.srpVerifier, keyset: input.keyset, discoverable: input.discoverable, createdAtMs: clock.now(), ...(input.bundleSig !== undefined && { bundleSig: input.bundleSig }),
      });
      if (made !== 'ok') return { ok: false, status: 409, code: made };
      await store.devices.add({ devId: input.device.devId, accountId: input.accountId, sigPk: input.device.sigPk, labelCt: input.device.labelCt ?? null, createdAtMs: clock.now(), revokedAtMs: null });
      await sendVerification(input.accountId, input.email.trim().toLowerCase());
      return { ok: true };
    },

    async status(accountId: string) {
      const a = await store.accounts.byId(accountId);
      if (a === undefined) return undefined;
      return { accountId, emailVerified: a.emailVerifiedAtMs !== null, verification: mail.enabled ? 'enabled' : 'disabled', discoverable: a.discoverable };
    },

    async keyset(accountId: string) {
      const a = await store.accounts.byId(accountId);
      return a === undefined ? undefined : { keyset: a.keyset, authSalt: a.authSalt, kdf: a.kdf };
    },

    /** Replaces verifier, salt, KDF and key set at once, and ends every other session (AUTH-6). */
    async rotate(accountId: string, currentSession: string, next: { authSalt: Uint8Array; kdf: KdfWireValue; srpVerifier: Uint8Array; keyset: Uint8Array }): Promise<void> {
      await store.accounts.replaceCredentials(accountId, { authSalt: next.authSalt, kdf: kdfToRecord(next.kdf), srpVerifier: next.srpVerifier, keyset: next.keyset });
      sessions.endAll(accountId, undefined, currentSession);
    },

    async setDiscoverable(accountId: string, value: boolean): Promise<void> {
      await store.accounts.setDiscoverable(accountId, value);
    },

    async verifyEmail(token: Uint8Array | string, ip: string): Promise<Outcome> {
      limit(`verify:ip:${ip}`, 20, 3_600_000);
      const raw = typeof token === 'string' ? Buffer.from(token, 'base64url') : Buffer.from(token);
      const accountId = await store.emailVerification.consume(createHash('sha256').update(raw).digest(), clock.now());
      if (accountId === undefined) return { ok: false, status: 400, code: 'rejected' };
      await store.accounts.setEmailVerified(accountId, clock.now());
      return { ok: true };
    },

    async resendVerification(accountId: string): Promise<void> {
      const a = await store.accounts.byId(accountId);
      if (a !== undefined && a.emailVerifiedAtMs === null) await sendVerification(accountId, a.email);
    },

    /** Deletes the account (FR-101) after a fresh proof: the caller's session must be recent and the proof must be its own M1. */
    async remove(accountId: string, sessionHex: string, freshProof: Uint8Array): Promise<Outcome> {
      const session = sessions.get(sessionHex);
      if (session === undefined || clock.now() - session.authenticatedAt > FRESH_MS || !Buffer.from(session.m1).equals(Buffer.from(freshProof))) return { ok: false, status: 403, code: 'fresh_proof_required' };
      const folds = await store.folds.list(accountId);
      for (const f of folds) {
        const members = await store.folds.members(f.foldId);
        if ((await store.folds.roleOf(f.foldId, accountId)) === 1 && members.length > 1) return { ok: false, status: 409, code: 'owns_shared_fold' };
      }
      for (const f of folds) if ((await store.folds.members(f.foldId)).length <= 1) await store.folds.remove(f.foldId);
      await store.accounts.remove(accountId, clock.now());
      return { ok: true };
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
