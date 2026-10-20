import {
  codeFromText, createMemberLookup, exportLedgerCsv, ROLE_CODE, ROLE_NAME, type AccountIdentity, type HistoryScope, type Id, type MembershipState, type PublicKeyBundle, type RoleCode,
} from '@cashfold/core';
import { createSharingCrypto, decodeInvitationCode, encodeInvitationCode, fingerprintQr, formatFingerprint, type Rng } from '@cashfold/crypto';
import type { OpenSession } from '../adapters/sqlite-opfs/web-session';
import type { Handlers } from './rpc';

// The Core Worker's sharing surface (contracts/core-api.md, "Sharing"): who is in a Fold, invitations, roles, removal, leaving.
// What crosses to the page is plain data: fingerprints as text groups, ids as text, key bundles as bytes.

export interface SharingHandlerDeps {
  readonly open: () => OpenSession;
  readonly identity: () => AccountIdentity | undefined;
  readonly rng: Rng;
  readonly nowMs: () => number;
}

export interface MemberView {
  readonly account: string;
  readonly role: 'owner' | 'editor' | 'viewer';
  readonly status: 'active' | 'removed' | 'left';
  readonly scope: HistoryScope;
  readonly fromEpoch: number;
  readonly invitedBy: string;
  readonly sinceMs: number;
  readonly fingerprint: readonly string[];
  readonly devices: ReadonlyArray<{ readonly id: string; readonly revoked: boolean }>;
  readonly isMe: boolean;
}

export interface SharingOverview {
  readonly shared: boolean;
  readonly me: string | undefined;
  readonly myRole: 'owner' | 'editor' | 'viewer' | undefined;
  readonly myScope: HistoryScope | undefined;
  readonly epoch: number;
  readonly server: string | null;
  readonly members: readonly MemberView[];
  /** Full-history invitations, which every member is told about (FR-102). */
  readonly notices: ReadonlyArray<{ readonly kind: 'full_history_invitation'; readonly subject: string; readonly by: string; readonly atMs: number }>;
}

export interface BundleView {
  readonly bundle: PublicKeyBundle;
  readonly fingerprint: readonly string[];
  readonly fingerprintQr: string;
}

export function createSharingHandlers({ open, identity, rng }: SharingHandlerDeps): Handlers {
  const crypto = createSharingCrypto({ rng });
  const handlers: Record<string, Handlers[string]> = {};
  const def = <A extends { fold: Id }>(method: string, run: (session: OpenSession, args: A) => Promise<unknown>): void => {
    handlers[method] = (async (args: A) => run(open(), args)) as unknown as Handlers[string];
  };
  const viewOf = (bundle: PublicKeyBundle): BundleView => {
    const fp = crypto.fingerprint(bundle.encPk, bundle.sigPk);
    return { bundle, fingerprint: formatFingerprint(fp), fingerprintQr: fingerprintQr(fp) };
  };

  async function overview(session: OpenSession, fold: Id): Promise<SharingOverview> {
    let state = await session.membership.state(fold);
    // The owner of a Fold that has never been shared has no log yet: it starts with them, alone, the first time anyone looks.
    if (state.ok && state.value.length === 0 && (await session.directory.get(fold))?.role === 'owner' && identity() !== undefined) {
      await session.membership.ensureGenesis(fold);
      state = await session.membership.state(fold);
    }
    const me = identity()?.accountId;
    if (!state.ok || state.value.length === 0) return { shared: false, me, myRole: undefined, myScope: undefined, epoch: 1, server: null, members: [], notices: [] };
    const s: MembershipState = state.value;
    const members = [...s.members.values()].map((m): MemberView => ({
      account: m.account, role: ROLE_NAME[m.role], status: m.status, scope: m.scope, fromEpoch: m.fromEpoch, invitedBy: m.invitedBy, sinceMs: m.addedTs,
      fingerprint: formatFingerprint(crypto.fingerprint(m.pubkeys.enc, m.pubkeys.sig)),
      devices: [...s.devices.values()].filter((d) => d.account === m.account).map((d) => ({ id: d.device, revoked: d.revokedAtTs !== undefined })),
      isMe: m.account === me,
    }));
    const entries = await session.membership.deps.store.list(fold);
    const notices = entries.filter((e) => e.type === 'add_member' && e.idx > 0 && e.scope === 'full').map((e) => ({ kind: 'full_history_invitation' as const, subject: e.subject, by: e.signer, atMs: e.ts }));
    const mine = me === undefined ? undefined : s.members.get(me);
    return {
      shared: s.members.size > 1, me, myRole: mine?.status === 'active' ? ROLE_NAME[mine.role] : undefined, myScope: mine?.scope, epoch: s.epoch, server: s.server,
      members: members.sort((a, b) => a.sinceMs - b.sinceMs), notices,
    };
  }

  def('sharing.overview', (session, a: { fold: Id }) => overview(session, a.fold));
  def('sharing.refresh', (session, a: { fold: Id }) => session.sharing.upkeep(a.fold));

  handlers['sharing.myCode'] = (async () => {
    const me = identity();
    if (me === undefined) return { ok: false, error: { code: 'no_identity', message: 'locked' } };
    const bundle = await crypto.signBundle({ accountId: me.accountId, encPk: me.encPk, sigSk: me.sigSk });
    const view = viewOf(bundle);
    return { ok: true, value: { ...view, code: encodeInvitationCode(bundle) } };
  }) as unknown as Handlers[string];

  const lookupFor = (session: OpenSession) => createMemberLookup({
    remote: session.membership.deps.remote, crypto: session.sharingCrypto, codes: { encode: (b) => encodeInvitationCode(b), decode: (t) => decodeInvitationCode(t) },
  });
  handlers['sharing.lookupEmail'] = (async (a: { email: string }) => {
    const r = await lookupFor(open()).byEmail(a.email);
    return r.ok ? { ok: true, value: viewOf(r.value) } : r;
  }) as unknown as Handlers[string];
  handlers['sharing.lookupCode'] = (async (a: { code: string }) => {
    const r = await lookupFor(open()).byCode(codeFromText(a.code));
    return r.ok ? { ok: true, value: viewOf(r.value) } : r;
  }) as unknown as Handlers[string];

  def('sharing.invite', (session, a: { fold: Id; bundle: PublicKeyBundle; role: RoleCode; scope: HistoryScope; fingerprintConfirmed: boolean; notifyEmail?: string }) =>
    session.sharing.inviteMember({
      fold: a.fold, bundle: a.bundle, role: a.role, scope: a.scope, fingerprintConfirmed: a.fingerprintConfirmed, ...(a.notifyEmail !== undefined && { notifyEmail: a.notifyEmail }),
    }));

  handlers['sharing.invitations'] = (async () => {
    const r = await open().sharing.pendingInvitations();
    if (!r.ok) return r;
    return {
      ok: true,
      value: r.value.map((i) => ({ ...i, inviterFingerprint: formatFingerprint(i.inviterFingerprint), role: ROLE_NAME[i.role] })),
    };
  }) as unknown as Handlers[string];

  def('sharing.accept', (session, a: { fold: Id; inviterFingerprintConfirmed: boolean }) => session.sharing.acceptInvitation(a));
  def('sharing.decline', (session, a: { fold: Id }) => session.sharing.declineInvitation(a.fold));
  def('sharing.changeRole', (session, a: { fold: Id; member: string; role: 'owner' | 'editor' | 'viewer' }) => session.sharing.changeRole({ fold: a.fold, member: a.member, role: ROLE_CODE[a.role] }));
  def('sharing.remove', (session, a: { fold: Id; member: string }) => session.sharing.removeMember(a));
  def('sharing.transfer', (session, a: { fold: Id; to: string }) => session.sharing.transferOwnership(a));
  def('sharing.leave', (session, a: { fold: Id }) => session.sharing.leaveFold(a.fold));

  /** The Fold as CSV, offered before someone leaves (FR-104). */
  def('sharing.exportCsv', async (session, a: { fold: Id }) => {
    const view = await session.views.get(a.fold, session.projections);
    return { ok: true, value: exportLedgerCsv(view.ledger) };
  });

  return handlers;
}
