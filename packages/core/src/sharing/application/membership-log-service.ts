import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { Role } from '../../shared-kernel/role';
import type { ClockPort } from '../../sync/ports/index';
import type { AccountIdentity, MembershipRemote, MembershipStore, OwnDevice, RemoteFailure, SharingCrypto } from '../ports/membership';
import type { FoldDirectory } from '../ports/index';
import {
  applyEntry, emptyMembership, replayLog, type MembershipEntry, type LogError, type MembershipState, type RoleCode,
} from '../domain/membership-log';

// Keeps this device's copy of a Fold's membership log in step with the service, verifying every entry from the first one.
// The service only carries the entries: what they mean is worked out here, so a service that drops, reorders or invents
// entries is caught by the chain and the signatures (FR-087, adversary A4).

export const ROLE_NAME: Readonly<Record<RoleCode, Role>> = { 1: 'owner', 2: 'editor', 3: 'viewer' };
export const ROLE_CODE: Readonly<Record<Role, RoleCode>> = { owner: 1, editor: 2, viewer: 3 };

export type SharingError = DomainError<
  RemoteFailure | LogError['code'] | 'no_identity' | 'unknown_fold' | 'not_owner' | 'fingerprint_not_confirmed' | 'invalid_bundle' | 'not_invited' |
  'invitation_expired' | 'grant_invalid' | 'log_invalid' | 'no_key' | 'self_target'
>;

export interface RefreshReport {
  /** Entries newly applied. */
  readonly added: number;
  /** What the log says about this account now. */
  readonly me: 'active' | 'removed' | 'left' | 'absent';
  readonly epoch: number;
}

export interface MembershipDeps {
  readonly store: MembershipStore;
  readonly remote: MembershipRemote;
  readonly crypto: SharingCrypto;
  readonly directory: FoldDirectory;
  readonly identity: () => AccountIdentity | undefined;
  readonly devices: () => Promise<readonly OwnDevice[]>;
  readonly clock: ClockPort;
}

const fail = (code: SharingError['code'], message: string): Result<never, SharingError> => err(code, message);
const remoteFail = (e: { code: RemoteFailure; message: string }): Result<never, SharingError> => err(e.code, e.message);

const MAX_ATTEMPTS = 3;

export function createMembershipLog(deps: MembershipDeps) {
  const { store, remote, crypto, directory, clock } = deps;
  const cache = new Map<Id, MembershipState>();

  const invalidate = (fold: Id): void => void cache.delete(fold);

  /** The state this device has verified, from the local copy of the log. Empty if there is no log yet. */
  async function state(fold: Id): Promise<Result<MembershipState, SharingError>> {
    const cached = cache.get(fold);
    if (cached !== undefined) return ok(cached);
    const entries = await store.list(fold);
    if (entries.length === 0) return ok(emptyMembership());
    const replayed = await replayLog(entries, crypto.log);
    if (!replayed.ok) return fail('log_invalid', `The membership log on this device does not verify: ${replayed.error.code}`);
    cache.set(fold, replayed.value);
    return ok(replayed.value);
  }

  /**
   * Fetches what the service has beyond the local log, verifies each entry against the state so far and keeps it. An entry that
   * does not verify stops the refresh and is reported: it is never kept. If the service holds no log yet (a Fold made before
   * sharing, or made offline), this device's own log is uploaded to it.
   */
  async function refresh(fold: Id): Promise<Result<RefreshReport, SharingError>> {
    const current = await state(fold);
    if (!current.ok) return current;
    let s = current.value;
    const fetched = await remote.fetchLog(fold, s.length - 1);
    if (!fetched.ok) return remoteFail(fetched.error);
    let added = 0;
    for (const entry of fetched.value.entries) {
      const next = await applyEntry(s, entry, crypto.log);
      if (!next.ok) return fail('log_invalid', `The service sent a log entry that does not verify: ${next.error.code}`);
      await store.append(fold, entry);
      s = next.value;
      added += 1;
    }
    cache.set(fold, s);

    // A log the service has never seen: send it, oldest first.
    if (fetched.value.head < 0 && s.length > 0) {
      const all = await store.list(fold);
      for (const entry of all) {
        const sent = await remote.postLog(fold, entry, []);
        if (!sent.ok && sent.error.code !== 'conflict') return remoteFail(sent.error);
      }
    }
    return ok({ ...report(s), added });
  }

  function report(s: MembershipState): RefreshReport {
    const me = deps.identity();
    const mine = me === undefined ? undefined : s.members.get(me.accountId);
    return { added: 0, me: mine?.status ?? 'absent', epoch: s.epoch };
  }

  /** Builds the next entry on a state, signed as this account. Times never go backwards. */
  async function build(s: MembershipState, draft: Omit<MembershipEntry, 'idx' | 'prev' | 'ts' | 'sig' | 'signer'>): Promise<Result<MembershipEntry, SharingError>> {
    const me = deps.identity();
    if (me === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const unsigned: Omit<MembershipEntry, 'sig'> = {
      ...draft, idx: s.length, prev: s.head ?? new Uint8Array(32), signer: me.accountId, ts: Math.max(clock.nowMs(), s.lastTs),
    };
    const entry = await crypto.signEntry(unsigned, me.sigSk);
    // Check it against the state first: an entry that cannot apply is never sent.
    const dry = await applyEntry(s, entry, crypto.log);
    return dry.ok ? ok(entry) : fail(dry.error.code, dry.error.message);
  }

  /** Runs `attempt` with the freshest state; if the log moved under it (another member appended), looks again, a few times. */
  async function withLatest<T>(fold: Id, attempt: (s: MembershipState) => Promise<Result<T, SharingError>>): Promise<Result<T, SharingError>> {
    let last: Result<T, SharingError> = fail('conflict', 'The membership log changed; try again');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const refreshed = await refresh(fold);
      if (!refreshed.ok) return refreshed;
      const s = await state(fold);
      if (!s.ok) return s;
      last = await attempt(s.value);
      if (last.ok || last.error.code !== 'conflict') return last;
    }
    return last;
  }

  /** Posts an entry (with grants), then keeps it locally. `conflict` means the service holds a newer entry. */
  async function commit(fold: Id, s: MembershipState, entry: MembershipEntry, grants: readonly Uint8Array[], invite?: { notifyEmail?: string }): Promise<Result<MembershipState, SharingError>> {
    const sent = invite === undefined
      ? await remote.postLog(fold, entry, grants)
      : await remote.invite(fold, entry, grants, invite.notifyEmail);
    if (!sent.ok) return remoteFail(sent.error);
    const next = await applyEntry(s, entry, crypto.log);
    if (!next.ok) return fail(next.error.code, next.error.message);
    await store.append(fold, entry);
    cache.set(fold, next.value);
    return ok(next.value);
  }

  /** Creates the first entry of a Fold this account made, if it has no log yet. Local only; it reaches the service with the next refresh. */
  async function ensureGenesis(fold: Id): Promise<Result<MembershipState, SharingError>> {
    const s = await state(fold);
    if (!s.ok || s.value.length > 0) return s;
    const me = deps.identity();
    if (me === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const summary = await directory.get(fold);
    if (summary === undefined) return fail('unknown_fold', 'That Fold is not on this device');
    if (summary.role !== 'owner') return fail('not_owner', 'Only the owner starts a Fold\'s log');
    const entry = await crypto.signEntry({
      idx: 0, prev: new Uint8Array(32), type: 'add_member', subject: me.accountId, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: me.encPk, sig: me.sigPk },
      signer: me.accountId, ts: clock.nowMs(),
    }, me.sigSk);
    const applied = await applyEntry(emptyMembership(), entry, crypto.log);
    if (!applied.ok) return fail(applied.error.code, applied.error.message);
    await store.append(fold, entry);
    cache.set(fold, applied.value);
    return ok(applied.value);
  }

  return { state, refresh, build, withLatest, commit, ensureGenesis, invalidate, deps };
}

export type MembershipLog = ReturnType<typeof createMembershipLog>;
