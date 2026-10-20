import { beforeEach, describe, expect, it } from 'vitest';
import type { PlainLogEntry } from '@cashfold/crypto';
import { LogBuilder, logCrypto, person, type Person } from '../../testing/index';
import { deviceAccount, emptyMembership, replayLog, roleAt, applyEntry, type MembershipState } from './membership-log';

let alice: Person, bob: Person, carol: Person;
let log: LogBuilder;

beforeEach(async () => {
  [alice, bob, carol] = [await person('ALICE1', 0xa1), await person('BOB222', 0xb1), await person('CAROL3', 0xc1)];
  log = new LogBuilder();
  await log.genesis(alice);
});

const replay = (entries: readonly PlainLogEntry[] = log.entries) => replayLog(entries, logCrypto);
const must = async (entries?: readonly PlainLogEntry[]): Promise<MembershipState> => {
  const r = await replay(entries);
  if (!r.ok) throw new Error(`replay failed: ${r.error.code}`);
  return r.value;
};
const rejects = async (code: string, entries?: readonly PlainLogEntry[]) => expect(await replay(entries)).toMatchObject({ ok: false, error: { code } });

describe('membership log: genesis and chain', () => {
  it('starts with the creator as the one owner at epoch 1', async () => {
    const s = await must();
    expect(s.length).toBe(1);
    expect(s.epoch).toBe(1);
    expect([...s.members.values()].map((m) => [m.account, m.role, m.status])).toEqual([['ALICE1', 1, 'active']]);
    expect(s.members.get('ALICE1')!.pubkeys.sig).toEqual(alice.sig.publicKey);
  });

  it('lets the creator own what was written before the log began, since a Fold is private until it is first shared', async () => {
    const s = await must();
    expect(roleAt(s, 'ALICE1', 1)).toBe(1);
    expect(roleAt(s, 'ALICE1', s.members.get('ALICE1')!.addedTs - 500)).toBe(1);
    expect(roleAt(s, 'BOB222', 1)).toBeUndefined();
  });

  it('refuses an empty log, a first entry that is not a self-signed owner entry, and a bad first signature', async () => {
    await rejects('empty_log', []);
    const other = new LogBuilder();
    await other.append(alice, { type: 'add_member', subject: bob.account, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: bob.enc.publicKey, sig: bob.sig.publicKey } });
    await rejects('bad_genesis', other.entries);
    const editor = new LogBuilder();
    await editor.append(alice, { type: 'add_member', subject: alice.account, role: 2, scope: 'full', fromEpoch: 1, pubkeys: { enc: alice.enc.publicKey, sig: alice.sig.publicKey } });
    await rejects('bad_genesis', editor.entries);
    const forged = new LogBuilder();
    await forged.append(bob, { type: 'add_member', subject: alice.account, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: alice.enc.publicKey, sig: alice.sig.publicKey } });
    await rejects('bad_genesis', forged.entries);
    await rejects('bad_signature', [{ ...log.entries[0]!, sig: new Uint8Array(64) }]);
  });

  it('links each entry to the hash of the one before and numbers them in order', async () => {
    await log.add(alice, bob, 2);
    expect((await must()).length).toBe(2);
    await rejects('chain_broken', [log.entries[0]!, { ...log.entries[1]!, prev: new Uint8Array(32).fill(1) }]);
    await rejects('chain_broken', [log.entries[0]!, { ...log.entries[1]!, idx: 5 }]);
    await rejects('chain_broken', [log.entries[1]!]);
  });

  it('detects a changed or removed entry anywhere in the chain', async () => {
    await log.add(alice, bob, 2);
    await log.add(alice, carol, 3);
    const tampered = [log.entries[0]!, { ...log.entries[1]!, role: 1 as const }, log.entries[2]!];
    await rejects('bad_signature', tampered);
    await rejects('chain_broken', [log.entries[0]!, log.entries[2]!]);
  });

  it('keeps the head hash of the last entry for the next append', async () => {
    await log.add(alice, bob, 2);
    const s = await must();
    expect(s.head).toEqual(await logCrypto.hash(log.entries[1]!));
  });
});

describe('membership log: who may do what (FR-087, FR-088)', () => {
  it('only an owner can add members, change roles and remove people', async () => {
    await log.add(alice, bob, 2);
    await log.append(bob, { type: 'add_member', subject: carol.account, role: 3, scope: 'full', fromEpoch: 1, pubkeys: { enc: carol.enc.publicKey, sig: carol.sig.publicKey } });
    await rejects('not_authorised');
  });

  it('an editor cannot promote themselves, and a viewer cannot promote anyone', async () => {
    await log.add(alice, bob, 2);
    await log.append(bob, { type: 'change_role', subject: bob.account, role: 1 });
    await rejects('not_authorised');
    const v = new LogBuilder();
    await v.genesis(alice);
    await v.add(alice, carol, 3);
    await v.append(carol, { type: 'change_role', subject: carol.account, role: 2 });
    await rejects('not_authorised', v.entries);
  });

  it('an owner can change roles and the change is remembered with its time', async () => {
    await log.add(alice, bob, 3);
    await log.append(alice, { type: 'change_role', subject: bob.account, role: 2, ts: 5_000 });
    const s = await must();
    expect(s.members.get('BOB222')!.role).toBe(2);
    expect(roleAt(s, 'BOB222', 1_020)).toBe(3);
    expect(roleAt(s, 'BOB222', 5_000)).toBe(2);
    expect(roleAt(s, 'BOB222', 999)).toBeUndefined();
  });

  it('the last owner can neither be removed, nor leave, nor be demoted', async () => {
    await log.append(alice, { type: 'leave', subject: alice.account });
    await rejects('last_owner');
    const d = new LogBuilder();
    await d.genesis(alice);
    await d.append(alice, { type: 'change_role', subject: alice.account, role: 2 });
    await rejects('last_owner', d.entries);
    const r = new LogBuilder();
    await r.genesis(alice);
    await r.add(alice, bob, 1);
    await r.append(bob, { type: 'remove_member', subject: alice.account });
    await r.append(alice, { type: 'remove_member', subject: bob.account });
    await rejects('not_authorised', r.entries);
  });

  it('with a second owner the first can leave or be demoted, and there is always one owner left', async () => {
    await log.add(alice, bob, 1);
    await log.append(alice, { type: 'leave', subject: alice.account });
    const s = await must();
    expect(s.members.get('ALICE1')!.status).toBe('left');
    expect(s.owners).toBe(1);
    await log.append(bob, { type: 'change_role', subject: bob.account, role: 2 });
    await rejects('last_owner');
  });

  it('cannot add someone who is already a member, remove or change someone who is not, or remove oneself', async () => {
    await log.add(alice, bob, 2);
    await log.add(alice, bob, 3);
    await rejects('already_member');
    const l = new LogBuilder();
    await l.genesis(alice);
    await l.append(alice, { type: 'remove_member', subject: carol.account });
    await rejects('not_a_member', l.entries);
    const m = new LogBuilder();
    await m.genesis(alice);
    await m.append(alice, { type: 'change_role', subject: carol.account, role: 2 });
    await rejects('not_a_member', m.entries);
    const n = new LogBuilder();
    await n.genesis(alice);
    await n.append(alice, { type: 'remove_member', subject: alice.account });
    await rejects('not_authorised', n.entries);
    const o = new LogBuilder();
    await o.genesis(alice);
    await o.add(alice, bob, 2);
    await o.append(alice, { type: 'change_role', subject: bob.account, role: 2 });
    await rejects('no_change', o.entries);
  });

  it('a removed member can no longer append anything, and can be invited again later', async () => {
    await log.add(alice, bob, 2);
    await log.append(alice, { type: 'remove_member', subject: bob.account });
    await log.append(alice, { type: 'rotate_epoch', subject: alice.account, epoch: 2 });
    const s = await must();
    expect(s.members.get('BOB222')!.status).toBe('removed');
    expect(s.epoch).toBe(2);
    const after = new LogBuilder();
    after.entries.push(...log.entries);
    await after.append(bob, { type: 'change_role', subject: bob.account, role: 1 });
    await rejects('not_authorised', after.entries);
    await log.add(alice, bob, 3, 'from_join', 2);
    expect((await must()).members.get('BOB222')).toMatchObject({ status: 'active', role: 3, scope: 'from_join', fromEpoch: 2 });
  });

  it('a member who leaves has left, and someone who is not a member cannot append', async () => {
    await log.add(alice, bob, 3);
    await log.append(bob, { type: 'leave', subject: bob.account });
    expect((await must()).members.get('BOB222')!.status).toBe('left');
    const outsider = new LogBuilder();
    await outsider.genesis(alice);
    await outsider.append(carol, { type: 'leave', subject: carol.account });
    await rejects('not_authorised', outsider.entries);
    const other = new LogBuilder();
    await other.genesis(alice);
    await other.add(alice, bob, 3);
    await other.append(bob, { type: 'leave', subject: alice.account });
    await rejects('not_authorised', other.entries);
  });

  it('rotates epochs one at a time, owners only', async () => {
    await log.append(alice, { type: 'rotate_epoch', subject: alice.account, epoch: 3 });
    await rejects('bad_epoch');
    const l = new LogBuilder();
    await l.genesis(alice);
    await l.add(alice, bob, 2);
    await l.append(bob, { type: 'rotate_epoch', subject: bob.account, epoch: 2 });
    await rejects('not_authorised', l.entries);
    const ok = new LogBuilder();
    await ok.genesis(alice);
    await ok.append(alice, { type: 'rotate_epoch', subject: alice.account, epoch: 2 });
    await ok.append(alice, { type: 'rotate_epoch', subject: alice.account, epoch: 3 });
    expect((await must(ok.entries)).epoch).toBe(3);
  });

  it('records the service address an owner points the Fold at', async () => {
    await log.append(alice, { type: 'set_server', subject: alice.account, server: 'https://relay.example.org' });
    expect((await must()).server).toBe('https://relay.example.org');
    const l = new LogBuilder();
    await l.genesis(alice);
    await l.add(alice, bob, 2);
    await l.append(bob, { type: 'set_server', subject: bob.account, server: 'https://evil.example' });
    await rejects('not_authorised', l.entries);
    const e = new LogBuilder();
    await e.genesis(alice);
    await e.append(alice, { type: 'set_server', subject: alice.account, server: '' });
    await rejects('invalid_entry', e.entries);
  });

  it('refuses entries that are missing what their type needs', async () => {
    for (const draft of [
      { type: 'add_member' as const, subject: bob.account, role: 2 as const, scope: 'full' as const, fromEpoch: 1 }, // no keys
      { type: 'add_member' as const, subject: bob.account, scope: 'full' as const, fromEpoch: 1, pubkeys: { enc: bob.enc.publicKey, sig: bob.sig.publicKey } }, // no role
      { type: 'add_member' as const, subject: bob.account, role: 2 as const, fromEpoch: 1, pubkeys: { enc: bob.enc.publicKey, sig: bob.sig.publicKey } }, // no scope
      { type: 'add_member' as const, subject: bob.account, role: 2 as const, scope: 'full' as const, pubkeys: { enc: bob.enc.publicKey, sig: bob.sig.publicKey } }, // no from_epoch
      { type: 'add_member' as const, subject: bob.account, role: 2 as const, scope: 'full' as const, fromEpoch: 9, pubkeys: { enc: bob.enc.publicKey, sig: bob.sig.publicKey } }, // from the future
      { type: 'change_role' as const, subject: alice.account },
    ]) {
      const l = new LogBuilder();
      await l.genesis(alice);
      await l.append(alice, draft);
      await rejects('invalid_entry', l.entries);
    }
  });
});

describe('membership log: devices', () => {
  it('certifies a device for its own account and answers who owns it', async () => {
    await log.add(alice, bob, 2);
    await log.device(alice);
    await log.device(bob);
    const s = await must();
    expect(deviceAccount(s, alice.device)).toBe('ALICE1');
    expect(deviceAccount(s, bob.device)).toBe('BOB222');
    expect(s.devices.get(bob.device)!.sigPk).toEqual(bob.devicePk);
    expect(deviceAccount(s, '00000000-0000-4000-8000-0000000000ff')).toBeUndefined();
  });

  it('a device belongs to the account that certified it, and is certified once', async () => {
    await log.add(alice, bob, 2);
    await log.append(bob, { type: 'add_device', subject: bob.device, pubkeys: { sig: bob.devicePk } });
    expect(deviceAccount(await must(), bob.device)).toBe('BOB222');
    await log.append(alice, { type: 'add_device', subject: bob.device, pubkeys: { sig: alice.devicePk } });
    await rejects('device_exists');
  });

  it('a revoked device is no longer certified, by its account or by an owner', async () => {
    await log.add(alice, bob, 2);
    await log.device(bob);
    await log.append(bob, { type: 'revoke_device', subject: bob.device });
    expect((await must()).devices.get(bob.device)!.revokedAtTs).toBeDefined();
    const o = new LogBuilder();
    o.entries.push(...log.entries.slice(0, 3));
    await o.append(alice, { type: 'revoke_device', subject: bob.device });
    expect((await must(o.entries)).devices.get(bob.device)!.revokedAtTs).toBeDefined();
    const c = new LogBuilder();
    c.entries.push(...log.entries.slice(0, 3));
    await c.add(alice, carol, 2);
    await c.append(carol, { type: 'revoke_device', subject: bob.device });
    await rejects('not_authorised', c.entries);
  });

  it('requires a device key, and a removed account loses the standing of its devices', async () => {
    const l = new LogBuilder();
    await l.genesis(alice);
    await l.append(alice, { type: 'add_device', subject: alice.device });
    await rejects('invalid_entry', l.entries);
    await log.add(alice, bob, 2);
    await log.device(bob);
    await log.append(alice, { type: 'remove_member', subject: bob.account });
    const s = await must();
    expect(deviceAccount(s, bob.device)).toBe('BOB222');
    expect(roleAt(s, 'BOB222', 1_000_000)).toBeUndefined();
  });
});

describe('incremental use', () => {
  it('applying entries one at a time gives the same state as replaying them all', async () => {
    await log.add(alice, bob, 2);
    await log.device(bob);
    await log.append(alice, { type: 'change_role', subject: bob.account, role: 3 });
    let state = emptyMembership();
    for (const e of log.entries) {
      const r = await applyEntry(state, e, logCrypto);
      if (!r.ok) throw new Error(r.error.code);
      state = r.value;
    }
    const full = await must();
    expect(state.head).toEqual(full.head);
    expect([...state.members.keys()]).toEqual([...full.members.keys()]);
    expect(state.members.get('BOB222')!.role).toBe(3);
  });

  it('does not change the state it was given when an entry is refused', async () => {
    const before = await must();
    const bad = await logCrypto.sign({ idx: 1, prev: before.head!, type: 'remove_member', subject: 'NOBODY', signer: alice.account, ts: 99_999 }, alice.sig.secretKey);
    expect(await applyEntry(before, bad, logCrypto)).toMatchObject({ ok: false });
    expect(before.length).toBe(1);
  });
});
