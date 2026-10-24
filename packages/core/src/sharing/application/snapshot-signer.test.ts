import { describe, expect, it } from 'vitest';
import { emptyMembership, type Member, type MembershipState, type RoleCode } from '../domain/membership-log';
import { snapshotSignerAllowed } from './op-authorisation';

const key = new Uint8Array(32);
const member = (account: string, scope: 'full' | 'from_join', roles: ReadonlyArray<RoleCode | undefined>): Member => ({
  account, role: roles.at(-1) ?? 3, status: 'active', pubkeys: { enc: key, sig: key }, scope, fromEpoch: scope === 'full' ? 1 : 2, addedIdx: 0, addedTs: 0, invitedBy: 'owner',
  roles: roles.map((role, i) => ({ atTs: i * 10, role })),
});
const world = (...members: Member[]): MembershipState => ({
  ...emptyMembership(),
  members: new Map(members.map((m) => [m.account, m])),
  devices: new Map(members.map((m) => [`dev-${m.account}`, { device: `dev-${m.account}`, account: m.account, sigPk: key, certifiedTs: 0 }])),
});

describe('snapshotSignerAllowed', () => {
  const s = world(
    member('owner', 'full', [1]),
    member('editor', 'full', [2]),
    member('viewer', 'full', [3]),
    member('promoted', 'full', [3, 2]),
    member('joined-later', 'from_join', [2]),
    member('removed-editor', 'full', [2, undefined]),
  );

  it('accepts a device of an owner or an editor who sees the whole history', () => {
    expect(snapshotSignerAllowed(s, 'dev-owner')).toBe(true);
    expect(snapshotSignerAllowed(s, 'dev-editor')).toBe(true);
    expect(snapshotSignerAllowed(s, 'dev-promoted')).toBe(true);
  });

  it('refuses a viewer, a member who joined with from-now-on history, and a device nobody certified', () => {
    expect(snapshotSignerAllowed(s, 'dev-viewer')).toBe(false);
    expect(snapshotSignerAllowed(s, 'dev-joined-later')).toBe(false);
    expect(snapshotSignerAllowed(s, 'dev-stranger')).toBe(false);
  });

  it('judges one of this account\'s own devices by the account, even when the log has no certificate for it', () => {
    expect(snapshotSignerAllowed(s, 'my-phone', 'editor')).toBe(true);
    expect(snapshotSignerAllowed(s, 'my-phone', 'viewer')).toBe(false);
    expect(snapshotSignerAllowed(s, 'my-phone', 'nobody')).toBe(false);
  });

  it('does not tell a removed editor from a current one: a snapshot carries no time (documented limit)', () => {
    expect(snapshotSignerAllowed(s, 'dev-removed-editor')).toBe(true);
  });
});
