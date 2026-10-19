import { createHash } from 'node:crypto';
import { decodeFoldKeyGrant, decodeLogEntry, encodeLogEntry, logEntrySigningBytes, type LogEntry } from '@cashfold/protocol';
import { emailMac } from '../../common/crypto-util.js';
import type { Clock, RateLimiter } from '../../common/rate-limit.js';
import type { ServerConfig } from '../../config.js';
import type { Store } from '../../store/store.js';
import type { Mailer } from '../mail/mail.js';
import { invitationMessage } from '../mail/mail.js';
import { verifyEd25519 } from '../folds/folds.service.js';
import { keysFromKeyset } from './bundle.js';

// Membership on the relay (ARCH 7.3, 9.6). The relay keeps each Fold's log and the table of current members that follows from
// it, so it can decide who may push ops and which ops to send whom. It checks structure and signatures; the clients check
// everything again from the first entry and never rely on it (adversary A4).

export const LOOKUPS_PER_DAY = 20;
export const INVITATIONS_PER_DAY = 20;
const DAY_MS = 24 * 3_600_000;
const MAX_GRANTS = 128;

export type Outcome<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 429; readonly code: string; readonly retryAfterSec?: number };

const fail = (status: 400 | 403 | 404 | 409 | 429, code: string, retryAfterSec?: number): Outcome<never> => ({ ok: false, status, code, ...(retryAfterSec !== undefined && { retryAfterSec }) });

export interface KeyBundle {
  readonly accountId: string;
  readonly encPk: Uint8Array;
  readonly sigPk: Uint8Array;
  readonly selfSig: Uint8Array;
}

const text = (b: Uint8Array): string => Buffer.from(b).toString('utf8');
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();
const isZero = (b: Uint8Array): boolean => b.length === 32 && b.every((x) => x === 0);

export function createMembershipService(deps: { store: Store; mail: Mailer; clock: Clock; limiter: RateLimiter; config: ServerConfig }) {
  const { store, mail, clock, limiter, config } = deps;

  /** The two public keys an account registered, read from its key set (the private halves are ciphertext the relay cannot open). */
  async function registeredKeys(accountId: string): Promise<{ encPk: Uint8Array; sigPk: Uint8Array } | undefined> {
    const a = await store.accounts.byId(accountId);
    if (a === undefined) return undefined;
    return keysFromKeyset(a.keyset);
  }

  async function bundleOf(accountId: string): Promise<KeyBundle | undefined> {
    const a = await store.accounts.byId(accountId);
    const keys = await registeredKeys(accountId);
    if (a === undefined || keys === undefined || a.bundleSig === null) return undefined;
    return { accountId, encPk: keys.encPk, sigPk: keys.sigPk, selfSig: a.bundleSig };
  }

  /** Invitable by address: the account opted in, and its address is confirmed where this service confirms addresses. */
  const findable = (a: { discoverable: boolean; emailVerifiedAtMs: number | null }): boolean => a.discoverable && (a.emailVerifiedAtMs !== null || !mail.enabled);

  /** The Fold's current key epoch: one more than the number of rotations in its log. */
  async function currentEpoch(foldId: Uint8Array): Promise<number> {
    const { entries } = await store.log.list(foldId, -1);
    return 1 + entries.filter((e) => decodeLogEntry(e).type === 'rotate_epoch').length;
  }

  async function activeOwners(foldId: Uint8Array): Promise<number> {
    let n = 0;
    for (const account of await store.folds.members(foldId)) if ((await store.folds.roleOf(foldId, account)) === 1) n += 1;
    return n;
  }

  /** Structural rules of one entry, given who is in the Fold now. Returns the effect on the member table. */
  async function check(foldId: Uint8Array, e: LogEntry, signerRole: number | undefined): Promise<Outcome<(() => Promise<void>) | undefined>> {
    const owner = signerRole === 1;
    const subject = text(e.subject);
    switch (e.type) {
      case 'add_member': {
        if (!owner) return fail(409, 'unauthorised');
        if (e.role === undefined || e.scope === undefined || e.from_epoch === undefined || e.pubkeys?.enc === undefined) return fail(400, 'bad_request');
        if ((await store.folds.roleOf(foldId, subject)) !== undefined) return fail(409, 'already_member');
        const keys = await registeredKeys(subject);
        // The keys named in the log are the ones the account registered: the inviter cannot slip in a key of their own.
        if (keys === undefined || !same(keys.encPk, e.pubkeys.enc) || !same(keys.sigPk, e.pubkeys.sig)) return fail(409, 'key_mismatch');
        const epoch = await currentEpoch(foldId);
        if (e.from_epoch < 1 || e.from_epoch > epoch || (e.scope === 'full' && e.from_epoch !== 1)) return fail(400, 'bad_request');
        return { ok: true, value: () => store.folds.addMember(foldId, subject, e.role!, e.from_epoch!) };
      }
      case 'remove_member': {
        if (!owner || subject === text(e.signer)) return fail(409, 'unauthorised');
        if ((await store.folds.roleOf(foldId, subject)) === undefined) return fail(409, 'not_a_member');
        return { ok: true, value: () => store.folds.removeMember(foldId, subject, clock.now()) };
      }
      case 'leave': {
        if (subject !== text(e.signer)) return fail(409, 'unauthorised');
        if (owner && (await activeOwners(foldId)) <= 1) return fail(409, 'last_owner');
        return { ok: true, value: () => store.folds.removeMember(foldId, subject, clock.now()) };
      }
      case 'change_role': {
        if (!owner || e.role === undefined) return fail(409, 'unauthorised');
        const current = await store.folds.roleOf(foldId, subject);
        if (current === undefined) return fail(409, 'not_a_member');
        if (current === e.role) return fail(409, 'no_change');
        if (current === 1 && e.role !== 1 && (await activeOwners(foldId)) <= 1) return fail(409, 'last_owner');
        return { ok: true, value: () => store.folds.setRole(foldId, subject, e.role!) };
      }
      case 'add_device':
        return e.pubkeys?.sig === undefined ? fail(400, 'bad_request') : { ok: true, value: undefined };
      case 'revoke_device':
        return { ok: true, value: undefined };
      case 'rotate_epoch':
        if (!owner) return fail(409, 'unauthorised');
        return e.epoch === (await currentEpoch(foldId)) + 1 ? { ok: true, value: undefined } : fail(409, 'bad_epoch');
      case 'set_server':
        return owner && e.server !== undefined && e.server.length > 0 && e.server.length <= 200 ? { ok: true, value: undefined } : fail(owner ? 400 : 409, owner ? 'bad_request' : 'unauthorised');
    }
  }

  /** Grants must be addressed to people who will be members, from the signer, for this Fold. Their content is the clients' business. */
  async function checkGrants(foldId: Uint8Array, e: LogEntry, raw: readonly Uint8Array[]): Promise<Outcome<Array<{ member: string; epoch: number; bytes: Uint8Array }>>> {
    if (raw.length > MAX_GRANTS) return fail(400, 'bad_request');
    const out: Array<{ member: string; epoch: number; bytes: Uint8Array }> = [];
    for (const bytes of raw) {
      let g;
      try {
        g = decodeFoldKeyGrant(bytes);
      } catch {
        return fail(400, 'bad_request');
      }
      const member = text(g.member);
      const willBeMember = (await store.folds.roleOf(foldId, member)) !== undefined && !(e.type === 'remove_member' && member === text(e.subject)) || (e.type === 'add_member' && member === text(e.subject));
      if (!same(g.fold, foldId) || text(g.granted_by) !== text(e.signer) || !willBeMember) return fail(400, 'bad_request');
      if (e.type === 'rotate_epoch' && g.epoch !== e.epoch) return fail(400, 'bad_request');
      out.push({ member, epoch: g.epoch, bytes });
    }
    return { ok: true, value: out };
  }

  async function append(foldId: Uint8Array, accountId: string, entryBytes: Uint8Array, grantBytes: readonly Uint8Array[], kind: 'log' | 'invite'): Promise<Outcome> {
    let e: LogEntry;
    try {
      e = decodeLogEntry(entryBytes);
    } catch {
      return fail(400, 'bad_request');
    }
    if (text(e.signer) !== accountId) return fail(403, 'forbidden');
    const last = await store.log.last(foldId);
    const role = await store.folds.roleOf(foldId, accountId);

    if (last === undefined) {
      // The first entry: the Fold's creator, as an owner, signing for themselves, with the keys they registered.
      const keys = await registeredKeys(accountId);
      if (role !== 1 || e.idx !== 0n || e.type !== 'add_member' || e.role !== 1 || text(e.subject) !== accountId || !isZero(e.prev) || e.scope !== 'full' || e.from_epoch !== 1) return fail(409, 'bad_genesis');
      if (keys === undefined || e.pubkeys?.enc === undefined || !same(e.pubkeys.enc, keys.encPk) || !same(e.pubkeys.sig, keys.sigPk)) return fail(409, 'key_mismatch');
      if (!verifyEd25519(keys.sigPk, logEntrySigningBytes(unsigned(e)), e.sig)) return fail(409, 'bad_signature');
      if (kind === 'invite') return fail(400, 'bad_request');
    } else {
      if (role === undefined) return fail(403, 'forbidden');
      if (e.idx !== BigInt(last.idx + 1) || !same(e.prev, last.hash)) return fail(409, 'chain_mismatch');
      const keys = await registeredKeys(accountId);
      if (keys === undefined || !verifyEd25519(keys.sigPk, logEntrySigningBytes(unsigned(e)), e.sig)) return fail(409, 'bad_signature');
      if (kind === 'invite' && e.type !== 'add_member') return fail(400, 'bad_request');
      if (kind === 'invite') {
        const d = limiter.hit(`invite:${accountId}`, INVITATIONS_PER_DAY, DAY_MS);
        if (!d.allowed) return fail(429, 'rate_limited', d.retryAfterSec);
      }
    }

    const effect = last === undefined ? ({ ok: true, value: undefined } as const) : await check(foldId, e, role);
    if (!effect.ok) return effect;
    const grants = await checkGrants(foldId, e, grantBytes);
    if (!grants.ok) return grants;

    const stored = await store.log.append(foldId, Number(e.idx), encodeLogEntry(e), sha256(encodeLogEntry(e)));
    if (stored === 'conflict') return fail(409, 'chain_mismatch');
    await effect.value?.();
    for (const g of grants.value) await store.grants.put(foldId, g.member, g.epoch, g.bytes);

    if (kind === 'invite' && mail.enabled) {
      const invitee = await store.accounts.byId(text(e.subject));
      const sender = await store.accounts.byId(accountId);
      // The invitee hears who is asking and nothing else: no Fold name, no members, no money (FR-107).
      if (invitee !== undefined && sender !== undefined) await mail.send(invitationMessage(invitee.email, sender.email, config.publicUrl));
    }
    return { ok: true, value: undefined };
  }

  const unsigned = (e: LogEntry): Omit<LogEntry, 'sig'> => {
    const { sig, ...rest } = e;
    void sig;
    return rest;
  };

  return {
    /** An address to a key bundle, for a signed-in caller who is allowed to ask and is within their daily allowance (FR-106). */
    async lookup(callerId: string, email: string): Promise<Outcome<KeyBundle>> {
      const caller = await store.accounts.byId(callerId);
      if (caller === undefined) return fail(403, 'forbidden');
      if (mail.enabled && caller.emailVerifiedAtMs === null) return fail(403, 'verification_required');
      const d = limiter.hit(`lookup:${callerId}`, LOOKUPS_PER_DAY, DAY_MS);
      if (!d.allowed) return fail(429, 'rate_limited', d.retryAfterSec);
      // The same work whether or not the address exists, so the answer's timing says nothing about it.
      const target = await store.accounts.byEmailHmac(emailMac(config.serverSecret, email));
      const bundle = target === undefined ? undefined : await bundleOf(target.accountId);
      const visible = target !== undefined && findable(target) && target.accountId !== callerId && bundle !== undefined;
      return visible ? { ok: true, value: bundle } : fail(404, 'not_found');
    },

    /** The bundle of an account the caller already shares a Fold with, or one that can be found by address. */
    async publicKeys(callerId: string, targetId: string): Promise<Outcome<KeyBundle>> {
      const d = limiter.hit(`keys:${callerId}`, LOOKUPS_PER_DAY * 5, DAY_MS);
      if (!d.allowed) return fail(429, 'rate_limited', d.retryAfterSec);
      const target = await store.accounts.byId(targetId);
      const bundle = target === undefined ? undefined : await bundleOf(targetId);
      if (target === undefined || bundle === undefined) return fail(404, 'not_found');
      let shared = false;
      for (const f of await store.folds.list(callerId)) if ((await store.folds.roleOf(f.foldId, targetId)) !== undefined) shared = true;
      return shared || findable(target) ? { ok: true, value: bundle } : fail(404, 'not_found');
    },

    /** Anyone who has been a member can read the log, so a removed member learns of it (ARCH 7.7). */
    async readLog(foldId: Uint8Array, accountId: string, after: number): Promise<Outcome<{ entries: readonly Uint8Array[]; head: number }>> {
      const mine = await store.folds.member(foldId, accountId);
      const { entries, head } = await store.log.list(foldId, after);
      // A Fold with no log yet has nothing to hide; otherwise only people who were once in it may read.
      if (head >= 0 && mine === undefined) return fail(403, 'forbidden');
      if (head < 0 && (await store.folds.roleOf(foldId, accountId)) === undefined) return fail(403, 'forbidden');
      return { ok: true, value: { entries, head } };
    },

    append,
    registeredKeys,
    bundleOf,
  };
}

export type MembershipService = ReturnType<typeof createMembershipService>;
