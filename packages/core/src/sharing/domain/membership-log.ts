import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';

// The membership log of a Fold (ARCH 7.3): append-only, hash-chained and signed. Everyone who is a member replays it
// from the first entry and derives, with no help from the service, who the members are, what each may do and when, which
// devices speak for them, and which key epoch is current. Nothing here trusts the service: it only carries the entries.

export type LogEntryType = 'add_member' | 'remove_member' | 'leave' | 'change_role' | 'add_device' | 'revoke_device' | 'rotate_epoch' | 'set_server';
export type RoleCode = 1 | 2 | 3; // 1 owner, 2 editor, 3 viewer
export type HistoryScope = 'full' | 'from_join';

/** One entry, in the plain form the core works with. The wire format is the crypto package's concern. */
export interface MembershipEntry {
  readonly idx: number;
  readonly prev: Uint8Array;
  readonly type: LogEntryType;
  /** An account id, or a device id for `add_device` and `revoke_device`. */
  readonly subject: string;
  readonly role?: RoleCode;
  readonly scope?: HistoryScope;
  readonly fromEpoch?: number;
  readonly server?: string;
  readonly pubkeys?: { readonly enc?: Uint8Array; readonly sig: Uint8Array };
  readonly epoch?: number;
  /** The account that signed the entry. */
  readonly signer: string;
  readonly ts: number;
  readonly sig: Uint8Array;
}

/** Hashing and signature checks, supplied by the crypto package. */
export interface LogCrypto {
  hash(entry: MembershipEntry): Promise<Uint8Array>;
  verify(entry: MembershipEntry, signerSigPk: Uint8Array): Promise<boolean>;
}

export interface Member {
  readonly account: string;
  readonly role: RoleCode;
  readonly status: 'active' | 'removed' | 'left';
  readonly pubkeys: { readonly enc: Uint8Array; readonly sig: Uint8Array };
  readonly scope: HistoryScope;
  /** The first key epoch this member can read. */
  readonly fromEpoch: number;
  readonly addedIdx: number;
  readonly addedTs: number;
  /** Which entry made the member `removed` or `left`. */
  readonly endedIdx?: number;
  /** The member's role over time: from `atTs` on, this role, or none (undefined) once they are out. */
  readonly roles: readonly { readonly atTs: number; readonly role: RoleCode | undefined }[];
  /** Who added them. */
  readonly invitedBy: string;
}

export interface DeviceCert {
  readonly device: string;
  readonly account: string;
  readonly sigPk: Uint8Array;
  readonly certifiedTs: number;
  readonly revokedAtTs?: number;
}

export interface MembershipState {
  /** Number of entries applied; the next entry has this index. */
  readonly length: number;
  /** Hash of the last entry, or undefined for an empty log. */
  readonly head: Uint8Array | undefined;
  readonly lastTs: number;
  readonly members: ReadonlyMap<string, Member>;
  readonly devices: ReadonlyMap<string, DeviceCert>;
  readonly epoch: number;
  readonly server: string | null;
  /** Active owners. */
  readonly owners: number;
  /** Index of the entry that started the current epoch (0 for the first). */
  readonly rotatedAtIdx: number;
  /** Index of the latest entry that took someone out (remove or leave), or -1. Newer than `rotatedAtIdx` means a key rotation is owed. */
  readonly departureIdx: number;
}

export type LogError = DomainError<
  'empty_log' | 'bad_genesis' | 'chain_broken' | 'bad_signature' | 'not_authorised' | 'invalid_entry' | 'already_member' | 'not_a_member' |
  'last_owner' | 'no_change' | 'bad_epoch' | 'device_exists' | 'unknown_device' | 'time_goes_back'
>;

export const emptyMembership = (): MembershipState => ({
  length: 0, head: undefined, lastTs: 0, members: new Map(), devices: new Map(), epoch: 1, server: null, owners: 0, rotatedAtIdx: 0, departureIdx: -1,
});

const fail = (code: LogError['code'], message: string): Result<never, LogError> => err(code, message);
const isRole = (r: unknown): r is RoleCode => r === 1 || r === 2 || r === 3;
const zeros = (b: Uint8Array): boolean => b.length === 32 && b.every((x) => x === 0);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const activeOwner = (s: MembershipState, account: string): boolean => {
  const m = s.members.get(account);
  return m?.status === 'active' && m.role === 1;
};

/** The role an account held at a moment, or undefined if it was not a member then. Uses the times the entries carry. */
export function roleAt(s: MembershipState, account: string, tsMs: number): RoleCode | undefined {
  const member = s.members.get(account);
  if (member === undefined) return undefined;
  let role: RoleCode | undefined;
  for (const r of member.roles) {
    if (r.atTs <= tsMs) role = r.role;
    else break;
  }
  return role;
}

/** The account a certified device belongs to. A revoked device still answers, so old ops can be attributed. */
export const deviceAccount = (s: MembershipState, device: string): string | undefined => s.devices.get(device)?.account;

/** The account's role now, if it is an active member. */
export const roleNow = (s: MembershipState, account: string): RoleCode | undefined => {
  const m = s.members.get(account);
  return m?.status === 'active' ? m.role : undefined;
};

function withMember(s: MembershipState, m: Member): ReadonlyMap<string, Member> {
  return new Map(s.members).set(m.account, m);
}

const ownersAfter = (members: ReadonlyMap<string, Member>): number => [...members.values()].filter((m) => m.status === 'active' && m.role === 1).length;

/**
 * Applies one entry to a state and returns the next state, or says why it is refused. The given state is never changed.
 * Checks, in order: position and chain, time, then who signed and whether they may, then the signature, then the rules of
 * the entry's own type.
 */
export async function applyEntry(state: MembershipState, entry: MembershipEntry, crypto: LogCrypto): Promise<Result<MembershipState, LogError>> {
  if (entry.idx !== state.length) return fail('chain_broken', 'The entry is not the next one in the log');
  if (state.length === 0) return genesis(entry, crypto);
  if (entry.prev.length !== 32 || state.head === undefined || !same(entry.prev, state.head)) return fail('chain_broken', 'The entry does not follow the one before it');
  if (!Number.isFinite(entry.ts) || entry.ts < state.lastTs) return fail('time_goes_back', 'Entries are in time order');

  const signer = state.members.get(entry.signer);
  if (signer === undefined || signer.status !== 'active') return fail('not_authorised', 'Only a current member can add to the log');
  if (!(await crypto.verify(entry, signer.pubkeys.sig))) return fail('bad_signature', 'The signature does not match the signer');

  const rule = await applyRule(state, entry);
  if (!rule.ok) return rule;
  return ok({ ...rule.value, length: state.length + 1, head: await crypto.hash(entry), lastTs: entry.ts });
}

async function genesis(entry: MembershipEntry, crypto: LogCrypto): Promise<Result<MembershipState, LogError>> {
  const keys = entry.pubkeys;
  if (
    entry.type !== 'add_member' || entry.role !== 1 || entry.subject !== entry.signer || keys?.enc === undefined || !zeros(entry.prev) ||
    entry.scope !== 'full' || entry.fromEpoch !== 1
  ) return fail('bad_genesis', 'A log starts with its creator, as an owner, signing for themselves');
  if (!(await crypto.verify(entry, keys.sig))) return fail('bad_signature', 'The first entry is not signed by its creator');
  const creator: Member = {
    account: entry.subject, role: 1, status: 'active', pubkeys: { enc: keys.enc, sig: keys.sig }, scope: 'full', fromEpoch: 1, addedIdx: 0, addedTs: entry.ts,
    roles: [{ atTs: entry.ts, role: 1 }], invitedBy: entry.subject,
  };
  return ok({ ...emptyMembership(), length: 1, head: await crypto.hash(entry), lastTs: entry.ts, members: new Map([[creator.account, creator]]), owners: 1 });
}

function applyRule(s: MembershipState, e: MembershipEntry): Result<Omit<MembershipState, 'length' | 'head' | 'lastTs'>, LogError> {
  const keep = { members: s.members, devices: s.devices, epoch: s.epoch, server: s.server, owners: s.owners, rotatedAtIdx: s.rotatedAtIdx, departureIdx: s.departureIdx };
  const ownerOnly = (): Result<never, LogError> | undefined => (activeOwner(s, e.signer) ? undefined : fail('not_authorised', 'Only an owner can do that'));

  switch (e.type) {
    case 'add_member': {
      const denied = ownerOnly();
      if (denied) return denied;
      if (!isRole(e.role) || e.pubkeys?.enc === undefined || e.scope === undefined || e.fromEpoch === undefined || e.subject === '') return fail('invalid_entry', 'A new member needs a role, keys, a history scope and the epoch they start from');
      if (!Number.isInteger(e.fromEpoch) || e.fromEpoch < 1 || e.fromEpoch > s.epoch) return fail('invalid_entry', 'The starting epoch must exist');
      if (e.scope === 'full' && e.fromEpoch !== 1) return fail('invalid_entry', 'Full history starts at the first epoch');
      if (s.members.get(e.subject)?.status === 'active') return fail('already_member', 'That person is already a member');
      const previous = s.members.get(e.subject);
      const member: Member = {
        account: e.subject, role: e.role, status: 'active', pubkeys: { enc: e.pubkeys.enc, sig: e.pubkeys.sig }, scope: e.scope, fromEpoch: e.fromEpoch,
        addedIdx: e.idx, addedTs: e.ts, roles: [...(previous?.roles ?? []), { atTs: e.ts, role: e.role }], invitedBy: e.signer,
      };
      const members = withMember(s, member);
      return ok({ ...keep, members, owners: ownersAfter(members) });
    }

    case 'remove_member': {
      const denied = ownerOnly();
      if (denied) return denied;
      if (e.subject === e.signer) return fail('not_authorised', 'Leave the Fold instead of removing yourself');
      const target = s.members.get(e.subject);
      if (target?.status !== 'active') return fail('not_a_member', 'That person is not a member');
      const members = withMember(s, { ...target, status: 'removed', endedIdx: e.idx, roles: [...target.roles, { atTs: e.ts, role: undefined }] });
      return ok({ ...keep, members, owners: ownersAfter(members), departureIdx: e.idx });
    }

    case 'leave': {
      if (e.subject !== e.signer) return fail('not_authorised', 'Only you can leave on your own behalf');
      const me = s.members.get(e.signer)!;
      if (me.role === 1 && s.owners <= 1) return fail('last_owner', 'The only owner cannot leave; make someone else an owner first');
      const members = withMember(s, { ...me, status: 'left', endedIdx: e.idx, roles: [...me.roles, { atTs: e.ts, role: undefined }] });
      return ok({ ...keep, members, owners: ownersAfter(members), departureIdx: e.idx });
    }

    case 'change_role': {
      const denied = ownerOnly();
      if (denied) return denied;
      if (!isRole(e.role)) return fail('invalid_entry', 'A role change needs a role');
      const target = s.members.get(e.subject);
      if (target?.status !== 'active') return fail('not_a_member', 'That person is not a member');
      if (target.role === e.role) return fail('no_change', 'That is already their role');
      if (target.role === 1 && e.role !== 1 && s.owners <= 1) return fail('last_owner', 'There must always be an owner');
      const members = withMember(s, { ...target, role: e.role, roles: [...target.roles, { atTs: e.ts, role: e.role }] });
      return ok({ ...keep, members, owners: ownersAfter(members) });
    }

    case 'add_device': {
      if (e.pubkeys?.sig === undefined || e.subject === '') return fail('invalid_entry', 'A device needs its signing key');
      if (s.devices.has(e.subject)) return fail('device_exists', 'That device is already certified');
      const cert: DeviceCert = { device: e.subject, account: e.signer, sigPk: e.pubkeys.sig, certifiedTs: e.ts };
      return ok({ ...keep, devices: new Map(s.devices).set(cert.device, cert) });
    }

    case 'revoke_device': {
      const cert = s.devices.get(e.subject);
      if (cert === undefined) return fail('unknown_device', 'That device is not certified');
      if (cert.account !== e.signer && !activeOwner(s, e.signer)) return fail('not_authorised', 'Only the device\'s account or an owner can revoke it');
      if (cert.revokedAtTs !== undefined) return fail('no_change', 'That device is already revoked');
      return ok({ ...keep, devices: new Map(s.devices).set(cert.device, { ...cert, revokedAtTs: e.ts }) });
    }

    case 'rotate_epoch': {
      const denied = ownerOnly();
      if (denied) return denied;
      if (e.epoch !== s.epoch + 1) return fail('bad_epoch', 'Epochs go up one at a time');
      return ok({ ...keep, epoch: e.epoch, rotatedAtIdx: e.idx });
    }

    case 'set_server': {
      const denied = ownerOnly();
      if (denied) return denied;
      if (typeof e.server !== 'string' || e.server.length < 1 || e.server.length > 200) return fail('invalid_entry', 'A service address is needed');
      return ok({ ...keep, server: e.server });
    }
  }
}

/** Verifies a whole log from its first entry and returns the state it describes. */
export async function replayLog(entries: readonly MembershipEntry[], crypto: LogCrypto): Promise<Result<MembershipState, LogError>> {
  if (entries.length === 0) return fail('empty_log', 'There is no log');
  let state = emptyMembership();
  for (const entry of entries) {
    const next = await applyEntry(state, entry, crypto);
    if (!next.ok) return next;
    state = next.value;
  }
  return ok(state);
}
