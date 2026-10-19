import type { Id } from '../../shared-kernel/id';
import { err, ok, type Result } from '../../shared-kernel/result';
import type { Secret } from '../../identity/ports/index';
import type { FoldSummary, SharingKeyring } from '../ports/index';
import type { PublicKeyBundle } from '../ports/membership';
import type { HistoryScope, MembershipEntry, MembershipState, RoleCode } from '../domain/membership-log';
import { ROLE_NAME, type MembershipLog, type SharingError } from './membership-log-service';

// Sharing a Fold with other people (FR-083 to FR-089): inviting, accepting, changing roles, removing, leaving. Every change is
// a signed entry in the membership log, and every change of who can read is a new key for the Fold. The service only carries
// them. All of these need the service, because other people can only learn of a change through it.

/** An invitation expires after this long without being accepted. */
export const INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Writes what a new member who joins "from now on" needs to make sense of the Fold, under the new key epoch (ARCH 7.6, FR-102). */
export interface HistoryWriter {
  baseline(args: { fold: Id; epoch: number; joiner: string; joinedLocalDate: number }): Promise<Result<{ records: number; checkpoints: number }, SharingError>>;
}

export interface CommandsDeps {
  readonly log: MembershipLog;
  readonly keyring: SharingKeyring;
  readonly history: HistoryWriter;
  /** The device's civil date, as yyyymmdd, for checkpoints. */
  readonly today: () => number;
  /** Removes everything this device holds for the Fold (rows, op log, keys, attachments, the log copy). */
  readonly wipe: (fold: Id) => Promise<void>;
}

export interface InviteInput {
  readonly fold: Id;
  readonly bundle: PublicKeyBundle;
  readonly role: RoleCode;
  readonly scope: HistoryScope;
  /** The inviter compared the fingerprint with the invitee, as they must for every shared Fold (FR-084). */
  readonly fingerprintConfirmed: boolean;
  readonly notifyEmail?: string;
}

export interface InvitationView {
  readonly fold: Id;
  readonly inviter: string;
  readonly inviterFingerprint: Uint8Array;
  readonly role: RoleCode;
  readonly scope: HistoryScope;
  readonly invitedAtMs: number;
  readonly status: 'pending' | 'expired';
}

const fail = (code: SharingError['code'], message: string): Result<never, SharingError> => err(code, message);

export function createMembershipCommands(deps: CommandsDeps) {
  const { log, keyring, history } = deps;
  const { crypto, directory, remote } = log.deps;
  const me = () => log.deps.identity();

  /** A key that is gone from the keyring cannot be sealed for anyone: say so rather than invite someone to nothing. */
  async function foldKey(fold: Id, epoch: number): Promise<Secret | undefined> {
    return keyring.key(fold, epoch);
  }

  async function grantsFor(fold: Id, s: MembershipState, recipient: { account: string; encPk: Uint8Array; role: RoleCode }, epochs: readonly number[]): Promise<Result<Uint8Array[], SharingError>> {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const out: Uint8Array[] = [];
    for (const epoch of epochs) {
      const key = await foldKey(fold, epoch);
      if (key === undefined) return fail('no_key', 'This device does not hold every key of the Fold');
      out.push(await crypto.sealGrant({
        fold, epoch, role: recipient.role, member: recipient.account, grantedBy: identity.accountId, recipientEncPk: recipient.encPk, foldKey: key, signingKey: identity.sigSk,
      }));
    }
    void s;
    return ok(out);
  }

  /**
   * Starts a new key epoch: a fresh Fold key, sealed to every active member. Everything written from now on uses it; what was
   * written before stays readable with the old keys, which the members keep. Returns the state after the entry.
   */
  async function rotate(fold: Id, s: MembershipState): Promise<Result<MembershipState, SharingError>> {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const entry = await log.build(s, { type: 'rotate_epoch', subject: identity.accountId, epoch: s.epoch + 1 });
    if (!entry.ok) return entry;
    const key = crypto.newFoldKey();
    const grants: Uint8Array[] = [];
    try {
      for (const m of s.members.values()) {
        if (m.status !== 'active') continue;
        grants.push(await crypto.sealGrant({
          fold, epoch: s.epoch + 1, role: m.role, member: m.account, grantedBy: identity.accountId, recipientEncPk: m.pubkeys.enc, foldKey: key, signingKey: identity.sigSk,
        }));
      }
    } catch (e) {
      key.wipe();
      throw e;
    }
    const committed = await log.commit(fold, s, entry.value, grants);
    if (!committed.ok) {
      key.wipe();
      return committed;
    }
    await keyring.importFoldKey(fold, s.epoch + 1, key); // takes ownership of the key
    const summary = await directory.get(fold);
    if (summary !== undefined) await directory.add({ ...summary, epoch: s.epoch + 1 });
    return committed;
  }

  /** Certifies this account's devices in the Fold's log, so other members can verify what they sign (ARCH 7.1). */
  async function certifyDevices(fold: Id): Promise<Result<number, SharingError>> {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const devices = await log.deps.devices();
    let changed = 0;
    return log.withLatest(fold, async (start) => {
      let s = start;
      for (const d of devices) {
        const cert = s.devices.get(d.id);
        let draft: Parameters<MembershipLog['build']>[1] | undefined;
        if (cert === undefined && !d.revoked) draft = { type: 'add_device', subject: d.id, pubkeys: { sig: d.sigPk } };
        else if (cert !== undefined && cert.account === identity.accountId && cert.revokedAtTs === undefined && d.revoked) draft = { type: 'revoke_device', subject: d.id };
        if (draft === undefined) continue;
        const entry = await log.build(s, draft);
        if (!entry.ok) return entry;
        const next = await log.commit(fold, s, entry.value, []);
        if (!next.ok) return next;
        s = next.value;
        changed += 1;
      }
      return ok(changed);
    });
  }

  const isShared = (s: MembershipState): boolean => s.members.size > 1;

  async function requireOwner(fold: Id, s: MembershipState): Promise<Result<true, SharingError>> {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const mine = s.members.get(identity.accountId);
    if (s.length === 0) return fail('unknown_fold', 'That Fold has no membership log on this device');
    return mine?.status === 'active' && mine.role === 1 ? ok(true as const) : fail('not_owner', 'Only an owner can do that');
  }

  const inviteMember = async (input: InviteInput): Promise<Result<{ epoch: number; scope: HistoryScope }, SharingError>> => {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    if (!input.fingerprintConfirmed) return fail('fingerprint_not_confirmed', 'Compare the fingerprint with the person you are inviting first');
    if (!(await crypto.verifyBundle(input.bundle))) return fail('invalid_bundle', 'Those keys are not properly signed');
    if (input.bundle.accountId === identity.accountId) return fail('self_target', 'You are already in this Fold');

    const started = await log.ensureGenesis(input.fold);
    if (!started.ok) return started;
    // The owner's devices speak for the owner in the log before anyone else reads it.
    const certified = await certifyDevices(input.fold);
    if (!certified.ok) return certified;

    return log.withLatest(input.fold, async (s0) => {
      const owner = await requireOwner(input.fold, s0);
      if (!owner.ok) return owner;
      if (s0.members.get(input.bundle.accountId)?.status === 'active') return fail('already_member', 'That person is already a member');
      let s = s0;
      let fromEpoch = 1;
      let epochs = await keyring.epochs(input.fold);

      if (input.scope === 'from_join') {
        // A new key first, so what the newcomer is given cannot open anything written before they joined.
        const rotated = await rotate(input.fold, s);
        if (!rotated.ok) return rotated;
        s = rotated.value;
        fromEpoch = s.epoch;
        epochs = [s.epoch];
        const wrote = await history.baseline({ fold: input.fold, epoch: s.epoch, joiner: input.bundle.accountId, joinedLocalDate: deps.today() });
        if (!wrote.ok) return wrote;
      }

      const entry = await log.build(s, {
        type: 'add_member', subject: input.bundle.accountId, role: input.role, scope: input.scope, fromEpoch,
        pubkeys: { enc: input.bundle.encPk, sig: input.bundle.sigPk },
      });
      if (!entry.ok) return entry;
      const grants = await grantsFor(input.fold, s, { account: input.bundle.accountId, encPk: input.bundle.encPk, role: input.role }, epochs.filter((e) => e >= fromEpoch));
      if (!grants.ok) return grants;
      const committed = await log.commit(input.fold, s, entry.value, grants.value, input.notifyEmail === undefined ? {} : { notifyEmail: input.notifyEmail });
      if (!committed.ok) return committed;
      return ok({ epoch: committed.value.epoch, scope: input.scope });
    });
  };

  /** Invitations waiting for this account: Folds the service says it belongs to that this device does not have yet. */
  const pendingInvitations = async (): Promise<Result<InvitationView[], SharingError>> => {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const listed = await remote.folds();
    if (!listed.ok) return fail(listed.error.code, listed.error.message);
    const out: InvitationView[] = [];
    for (const fold of listed.value) {
      if ((await directory.get(fold)) !== undefined) continue;
      const refreshed = await log.refresh(fold);
      if (!refreshed.ok) continue; // a log that does not verify is not an invitation to trust
      const s = await log.state(fold);
      const mine = s.ok ? s.value.members.get(identity.accountId) : undefined;
      if (!s.ok || mine === undefined || mine.status !== 'active') continue;
      const inviter = s.value.members.get(mine.invitedBy);
      if (inviter === undefined) continue;
      out.push({
        fold, inviter: inviter.account, inviterFingerprint: crypto.fingerprint(inviter.pubkeys.enc, inviter.pubkeys.sig), role: mine.role, scope: mine.scope,
        invitedAtMs: mine.addedTs, status: log.deps.clock.nowMs() - mine.addedTs > INVITATION_LIFETIME_MS ? 'expired' : 'pending',
      });
    }
    return ok(out);
  };

  /**
   * Opens the keys the service holds for this account that this device does not have yet, and keeps those that check out: sealed
   * by an owner of the Fold, for the role the log gives this account, for an epoch it may read. Returns the newest epoch held.
   */
  async function importGrants(fold: Id, s: MembershipState, account: string): Promise<Result<number, SharingError>> {
    const identity = me();
    const mine = s.members.get(account);
    if (identity === undefined || mine === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const have = new Set(await keyring.epochs(fold));
    const fetched = await remote.fetchGrants(fold);
    if (!fetched.ok) return fail(fetched.error.code, fetched.error.message);
    const keys: Array<{ epoch: number; key: Secret }> = [];
    for (const bytes of fetched.value) {
      const info = crypto.readGrant(bytes);
      if (info === undefined || info.fold !== fold || info.member !== account || have.has(info.epoch) || keys.some((k) => k.epoch === info.epoch)) continue;
      const granter = s.members.get(info.grantedBy);
      if (granter === undefined || granter.role !== 1 || info.role !== mine.role || info.epoch < mine.fromEpoch || info.epoch > s.epoch) continue;
      const key = await crypto.openGrant({ grant: bytes, encSk: identity.encSk, granterSigPk: granter.pubkeys.sig });
      if (key !== undefined) keys.push({ epoch: info.epoch, key });
    }
    const newest = Math.max(0, ...have, ...keys.map((k) => k.epoch));
    // Without the key of the epoch the Fold is on now, there is nothing this device could read or write.
    if (newest !== s.epoch) {
      for (const k of keys) k.key.wipe();
      return fail('grant_invalid', 'The keys sent with the invitation could not be verified');
    }
    for (const k of keys) await keyring.importFoldKey(fold, k.epoch, k.key);
    return ok(newest);
  }

  /** Accepts an invitation: checks the log from its first entry, opens the keys the inviter sealed, and joins. */
  const acceptInvitation = async (input: { fold: Id; inviterFingerprintConfirmed: boolean }): Promise<Result<FoldSummary, SharingError>> => {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    if (!input.inviterFingerprintConfirmed) return fail('fingerprint_not_confirmed', 'Compare the fingerprint with the person who invited you first');
    const refreshed = await log.refresh(input.fold);
    if (!refreshed.ok) return refreshed;
    const stateResult = await log.state(input.fold);
    if (!stateResult.ok) return stateResult;
    const s = stateResult.value;
    const mine = s.members.get(identity.accountId);
    if (mine === undefined || mine.status !== 'active') return fail('not_invited', 'There is no invitation for you in that Fold');
    if (mine.pubkeys.sig.some((b, i) => b !== identity.sigPk[i]) || (mine.pubkeys.enc.some((b, i) => b !== identity.encPk[i]))) {
      return fail('not_invited', 'The invitation was made for other keys than yours');
    }
    if (log.deps.clock.nowMs() - mine.addedTs > INVITATION_LIFETIME_MS) return fail('invitation_expired', 'This invitation has expired; ask for a new one');

    const imported = await importGrants(input.fold, s, identity.accountId);
    if (!imported.ok) return imported;
    const current = imported.value;
    const summary: FoldSummary = { id: input.fold, name: 'Shared Fold', baseCurrency: 'USD', epoch: current, role: ROLE_NAME[mine.role] };
    await directory.add(summary);
    const certified = await certifyDevices(input.fold);
    if (!certified.ok && certified.error.code !== 'offline') return certified;
    return ok(summary);
  };

  /** Turns an invitation down: leaves the Fold before ever opening it. */
  const declineInvitation = async (fold: Id): Promise<Result<true, SharingError>> => {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    return log.withLatest(fold, async (s) => {
      if (s.members.get(identity.accountId)?.status !== 'active') return fail('not_invited', 'There is no invitation for you in that Fold');
      const entry = await log.build(s, { type: 'leave', subject: identity.accountId });
      if (!entry.ok) return entry;
      const done = await log.commit(fold, s, entry.value, []);
      return done.ok ? ok(true as const) : done;
    });
  };

  const changeRole = async (input: { fold: Id; member: string; role: RoleCode }): Promise<Result<true, SharingError>> =>
    log.withLatest(input.fold, async (s) => {
      const owner = await requireOwner(input.fold, s);
      if (!owner.ok) return owner;
      const entry = await log.build(s, { type: 'change_role', subject: input.member, role: input.role });
      if (!entry.ok) return entry;
      // The member's grants carry their role, so the current key is sealed again with the new one.
      const target = s.members.get(input.member);
      const identity = me()!;
      const key = await foldKey(input.fold, s.epoch);
      const grants: Uint8Array[] = [];
      if (target !== undefined && key !== undefined) {
        grants.push(await crypto.sealGrant({ fold: input.fold, epoch: s.epoch, role: input.role, member: input.member, grantedBy: identity.accountId, recipientEncPk: target.pubkeys.enc, foldKey: key, signingKey: identity.sigSk }));
      }
      const done = await log.commit(input.fold, s, entry.value, grants);
      return done.ok ? ok(true as const) : done;
    });

  /** Gives the Fold to another member: they become an owner, then you become an editor. */
  const transferOwnership = async (input: { fold: Id; to: string }): Promise<Result<true, SharingError>> => {
    const promoted = await changeRole({ fold: input.fold, member: input.to, role: 1 });
    if (!promoted.ok) return promoted;
    const identity = me()!;
    return changeRole({ fold: input.fold, member: identity.accountId, role: 2 });
  };

  /** Takes someone out and moves the Fold to a new key, so they cannot read what is written from now on (FR-086). */
  const removeMember = async (input: { fold: Id; member: string }): Promise<Result<{ epoch: number }, SharingError>> =>
    log.withLatest(input.fold, async (s0) => {
      const owner = await requireOwner(input.fold, s0);
      if (!owner.ok) return owner;
      if (input.member === me()!.accountId) return fail('self_target', 'Leave the Fold instead of removing yourself');
      const entry = await log.build(s0, { type: 'remove_member', subject: input.member });
      if (!entry.ok) return entry;
      const removed = await log.commit(input.fold, s0, entry.value, []);
      if (!removed.ok) return removed;
      const rotated = await rotate(input.fold, removed.value);
      // The removal stands even if the new key could not be made now; the next owner to connect finishes it.
      return rotated.ok ? ok({ epoch: rotated.value.epoch }) : ok({ epoch: removed.value.epoch });
    });

  /** Leaves a Fold. This device then forgets it (FR-104); an owner who stays makes the new key at their next contact. */
  const leaveFold = async (fold: Id): Promise<Result<true, SharingError>> => {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const left = await log.withLatest(fold, async (s) => {
      const entry = await log.build(s, { type: 'leave', subject: identity.accountId });
      if (!entry.ok) return entry;
      return log.commit(fold, s, entry.value, []);
    });
    if (!left.ok) return left;
    await deps.wipe(fold);
    return ok(true as const);
  };

  /** Makes the key rotation that a removal or departure owes, if this account is an owner and nobody has yet. */
  const completeRotation = async (fold: Id): Promise<Result<boolean, SharingError>> =>
    log.withLatest(fold, async (s) => {
      if (s.departureIdx <= s.rotatedAtIdx) return ok(false);
      const owner = await requireOwner(fold, s);
      if (!owner.ok) return ok(false);
      const rotated = await rotate(fold, s);
      return rotated.ok ? ok(true) : rotated;
    });

  /**
   * One pass of upkeep for a Fold, run after every sync: bring the log up to date, forget the Fold if this account is out of
   * it, finish a rotation that is owed, and certify this account's devices once the Fold is shared.
   */
  const upkeep = async (fold: Id): Promise<Result<{ outcome: 'wiped' | 'active'; role: RoleCode | undefined }, SharingError>> => {
    const identity = me();
    if (identity === undefined) return fail('no_identity', 'This device cannot sign: the account is locked');
    const refreshed = await log.refresh(fold);
    if (!refreshed.ok) return refreshed;
    if (refreshed.value.me === 'removed' || refreshed.value.me === 'left') {
      await deps.wipe(fold);
      return ok({ outcome: 'wiped', role: undefined });
    }
    const s = await log.state(fold);
    if (!s.ok) return s;
    const mine = s.value.members.get(identity.accountId);
    if (mine === undefined) return ok({ outcome: 'active', role: undefined });
    // The directory follows the log: this account's role, and the newest key it holds.
    const summary = await directory.get(fold);
    if (summary !== undefined) {
      const latest = Math.max(summary.epoch, ...(await keyring.epochs(fold)));
      if (summary.role !== ROLE_NAME[mine.role] || summary.epoch !== latest) await directory.add({ ...summary, role: ROLE_NAME[mine.role], epoch: latest });
    }
    // A rotation made by another owner brings a key for this account to collect.
    if ((await keyring.epochs(fold)).at(-1)! < s.value.epoch) await importGrants(fold, s.value, identity.accountId);
    if (mine.role === 1) await completeRotation(fold);
    if (isShared(s.value)) await certifyDevices(fold);
    return ok({ outcome: 'active', role: mine.role });
  };

  return {
    inviteMember, pendingInvitations, acceptInvitation, declineInvitation, changeRole, transferOwnership, removeMember, leaveFold,
    completeRotation, certifyDevices, upkeep,
  };
}

export type MembershipCommands = ReturnType<typeof createMembershipCommands>;
export type { MembershipEntry };
