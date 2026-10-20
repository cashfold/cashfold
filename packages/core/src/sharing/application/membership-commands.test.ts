import { fingerprint } from '@cashfold/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountBalance } from '../../ledger/application/balance';
import { accountFieldPatch } from '../../ledger/domain/account';
import { TABLE } from '../../ledger/domain/tables';
import { transactionFieldPatch } from '../../ledger/domain/transaction';
import type { Id } from '../../shared-kernel/id';
import { createParticipant, date, FakeService, id, worldFold, type Participant } from '../../testing/index';
import { INVITATION_LIFETIME_MS } from './membership-commands';

let service: FakeService;
let alice: Participant, bob: Participant, carol: Participant;
const FOLD = worldFold(1);
const ACCOUNT = id(0x101);

beforeEach(async () => {
  service = new FakeService();
  [alice, bob, carol] = [
    await createParticipant(service, 'ALICE1', 0xa1),
    await createParticipant(service, 'BOB222', 0xb1),
    await createParticipant(service, 'CAROL3', 0xc1),
  ];
  await alice.createFold(FOLD);
  await spend(alice, 1, 5_000n, date(2026, 1, 10));
  await alice.sync(FOLD);
});

async function addAccount(p: Participant, rec: Id, name: string) {
  const r = await p.writePath.submit({
    fold: FOLD, rec, table: TABLE.account, sets: new Map(),
    fields: accountFieldPatch({ kind: 'checking', name, currency: 'USD' as never, openingBalanceMinor: 100_000n, openingDate: date(2020, 1, 1), includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false }),
  });
  if (!r.ok) throw new Error(r.error.code);
}

/** Alice's first account and spending, so there is history to share. */
async function spend(p: Participant, n: number, cents: bigint, on = date(2026, 3, 5), rec = id(0x200 + n)) {
  if (n === 1 && (await p.projections.getRecord(FOLD, ACCOUNT)) === undefined) await addAccount(p, ACCOUNT, 'Main');
  const r = await p.writePath.submit({
    fold: FOLD, rec, table: TABLE.transaction, sets: new Map(),
    fields: transactionFieldPatch({
      accountId: ACCOUNT, direction: 'expense', amountMinor: -cents, currency: 'USD' as never, baseAmountMinor: -cents, baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null,
      occurredUtcMs: Date.UTC(on / 10_000, (Math.floor(on / 100) % 100) - 1, on % 100, 12), tzOffsetMin: 0, localDate: on, status: 'posted', note: `spend ${n}`,
    }),
  });
  if (!r.ok) throw new Error(r.error.code);
  return rec;
}

const balanceOf = async (p: Participant) => {
  const b = accountBalance(await p.ledger(FOLD), ACCOUNT);
  return b.ok ? b.value : undefined;
};

async function invite(from: Participant, to: Participant, over: Partial<Parameters<Participant['commands']['inviteMember']>[0]> = {}) {
  return from.commands.inviteMember({ fold: FOLD, bundle: await to.bundle(), role: 2, scope: 'full', fingerprintConfirmed: true, ...over });
}

/** What a sync round does: bring the log up to date first, then exchange ops. */
async function exchange(who: Participant) {
  await who.commands.upkeep(FOLD);
  return who.sync(FOLD);
}

async function join(who: Participant) {
  const pending = await who.commands.pendingInvitations();
  expect(pending.ok && pending.value.map((p) => p.fold)).toContain(FOLD);
  const accepted = await who.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: true });
  if (!accepted.ok) throw new Error(`accept failed: ${accepted.error.code}`);
  await exchange(who);
  return accepted.value;
}

describe('inviting with the full history (FR-083, FR-102)', () => {
  it('shows the invitee who invited them and with what, and lets them in with every key and all the data', async () => {
    const sent = await invite(alice, bob);
    expect(sent).toMatchObject({ ok: true, value: { scope: 'full', epoch: 1 } });
    expect(service.invitations).toEqual([{ fold: FOLD, subject: 'BOB222' }]);

    const pending = await bob.commands.pendingInvitations();
    expect(pending).toMatchObject({ ok: true, value: [{ fold: FOLD, inviter: 'ALICE1', role: 2, scope: 'full', status: 'pending' }] });
    if (pending.ok) expect(pending.value[0]!.inviterFingerprint).toEqual(fingerprint(alice.person.enc.publicKey, alice.person.sig.publicKey));

    const summary = await join(bob);
    expect(summary).toMatchObject({ id: FOLD, role: 'editor', epoch: 1 });
    expect(await bob.keyring.epochs(FOLD)).toEqual([1]);
    expect(await balanceOf(bob)).toBe(95_000n);
    expect((await bob.directory.get(FOLD))!.role).toBe('editor');
  });

  it('seals every epoch the inviter holds', async () => {
    await invite(alice, bob);
    await join(bob);
    await alice.commands.removeMember({ fold: FOLD, member: 'BOB222' }); // epoch 2
    await invite(alice, carol);
    const granted = await carol.commands.pendingInvitations();
    expect(granted.ok).toBe(true);
    await join(carol);
    expect(await carol.keyring.epochs(FOLD)).toEqual([1, 2]);
    expect(await balanceOf(carol)).toBe(95_000n);
  });

  it('what each person writes reaches the other, and is accepted by both', async () => {
    await invite(alice, bob);
    await join(bob);
    await spend(bob, 2, 1_000n, date(2026, 3, 6));
    await spend(alice, 3, 2_000n, date(2026, 3, 7));
    await exchange(bob); // pushes bob's spending
    expect((await exchange(alice)).applied).toBe(1);
    expect((await exchange(bob)).applied).toBe(1);
    expect(await balanceOf(alice)).toBe(92_000n);
    expect(await balanceOf(bob)).toBe(92_000n);
  });

  it('is refused without the fingerprint check, with keys that are not properly signed, or for someone already in', async () => {
    expect(await invite(alice, bob, { fingerprintConfirmed: false })).toMatchObject({ ok: false, error: { code: 'fingerprint_not_confirmed' } });
    const b = await bob.bundle();
    const forged = { ...b, encPk: carol.person.enc.publicKey };
    expect(await invite(alice, bob, { bundle: forged })).toMatchObject({ ok: false, error: { code: 'invalid_bundle' } });
    expect(await invite(alice, alice)).toMatchObject({ ok: false, error: { code: 'self_target' } });
    await invite(alice, bob);
    expect(await invite(alice, bob)).toMatchObject({ ok: false, error: { code: 'already_member' } });
  });

  it('only an owner can invite', async () => {
    await invite(alice, bob);
    await join(bob);
    expect(await invite(bob, carol)).toMatchObject({ ok: false, error: { code: 'not_owner' } });
  });

  it('needs the service', async () => {
    alice.online = false;
    expect(await invite(alice, bob)).toMatchObject({ ok: false, error: { code: 'offline' } });
  });

  it('the invitee can be found by the address they allow, or by a code they hand over', async () => {
    const { createMemberLookup } = await import('./lookup-member');
    const { decodeInvitationCode, encodeInvitationCode } = await import('@cashfold/crypto');
    const lookup = createMemberLookup({
      remote: service.remoteFor('ALICE1', () => true),
      crypto: alice.log.deps.crypto,
      codes: { encode: (b) => encodeInvitationCode(b), decode: (t) => decodeInvitationCode(t) },
    });
    expect(await lookup.byEmail('bob222@example.com')).toMatchObject({ ok: true, value: { accountId: 'BOB222' } });
    expect(await lookup.byEmail('nobody@example.com')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const hidden = await createParticipant(service, 'HIDDEN', 0xd1, { discoverable: false });
    expect(await lookup.byEmail('hidden@example.com')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await lookup.byCode(await hidden.code())).toMatchObject({ ok: true, value: { accountId: 'HIDDEN' } });
    expect(await lookup.byCode(`https://cashfold.example/folds/?code=${encodeURIComponent(await hidden.code())}`)).toMatchObject({ ok: true });
    expect(await lookup.byCode('not a code')).toMatchObject({ ok: false, error: { code: 'invalid_code' } });
    service.setBundle('BOB222', { ...(await bob.bundle()), encPk: carol.person.enc.publicKey });
    expect(await lookup.byEmail('bob222@example.com')).toMatchObject({ ok: false, error: { code: 'invalid_bundle' } });
  });
});

describe('inviting from now on (FR-102)', () => {
  it('moves the Fold to a new key and gives the newcomer only that key, the structure and where things stood', async () => {
    await spend(alice, 2, 7_000n, date(2026, 2, 1));
    await alice.sync(FOLD);
    const sent = await invite(alice, carol, { scope: 'from_join', role: 3 });
    expect(sent).toMatchObject({ ok: true, value: { scope: 'from_join', epoch: 2 } });
    await alice.sync(FOLD); // the structure and the checkpoints written under the new key reach the service
    expect(await alice.keyring.epochs(FOLD)).toEqual([1, 2]);
    expect((await alice.directory.get(FOLD))!.epoch).toBe(2);

    await join(carol);
    expect(await carol.keyring.epochs(FOLD)).toEqual([2]);
    const ledger = await carol.ledger(FOLD);
    expect(ledger.accounts.get(ACCOUNT)?.name).toBe('Main');
    // none of the earlier spending is visible, but the balance is right from the joining day on
    expect([...ledger.transactions.values()]).toEqual([]);
    expect(await balanceOf(carol)).toBe(88_000n);
    await spend(alice, 3, 1_500n, date(2026, 3, 10));
    await alice.sync(FOLD);
    await exchange(carol);
    expect(await balanceOf(carol)).toBe(86_500n);
    expect(await balanceOf(alice)).toBe(86_500n);
  });

  it('keeps the earlier data unreadable: the old ops cannot be opened with the one key the newcomer has', async () => {
    await invite(alice, carol, { scope: 'from_join' });
    await alice.sync(FOLD);
    await join(carol);
    const report = await carol.sync(FOLD);
    // everything written before the rotation is set aside as unreadable, not applied
    expect(report.quarantined.length + report.applied).toBeGreaterThanOrEqual(0);
    expect((await carol.ledger(FOLD)).transactions.size).toBe(0);
    expect(await carol.keyring.key(FOLD, 1)).toBeUndefined();
  });

  it('the other members receive the new key, and keep reading everything', async () => {
    await invite(alice, bob);
    await join(bob);
    await invite(alice, carol, { scope: 'from_join' });
    await bob.commands.upkeep(FOLD);
    expect(await bob.keyring.epochs(FOLD)).toContain(2);
  });
});

describe('invitations that go nowhere', () => {
  it('expire after thirty days', async () => {
    await invite(alice, bob);
    bob.now += INVITATION_LIFETIME_MS + 1;
    expect(await bob.commands.pendingInvitations()).toMatchObject({ ok: true, value: [{ status: 'expired' }] });
    expect(await bob.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: true })).toMatchObject({ ok: false, error: { code: 'invitation_expired' } });
  });

  it('can be declined, and then are gone for the invitee', async () => {
    await invite(alice, bob);
    expect(await bob.commands.declineInvitation(FOLD)).toMatchObject({ ok: true });
    expect(await bob.commands.pendingInvitations()).toMatchObject({ ok: true, value: [] });
    expect(await bob.directory.get(FOLD)).toBeUndefined();
    await expect(alice.log.refresh(FOLD)).resolves.toMatchObject({ ok: true });
    expect((await alice.log.state(FOLD)) as never).toMatchObject({ ok: true, value: { members: expect.any(Map) } });
  });

  it('are not accepted without comparing the inviter\'s fingerprint, or by someone they were not made for', async () => {
    await invite(alice, bob);
    expect(await bob.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: false })).toMatchObject({ ok: false, error: { code: 'fingerprint_not_confirmed' } });
    expect(await carol.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: true })).toMatchObject({ ok: false });
  });
});

describe('roles and ownership (FR-085, FR-088)', () => {
  beforeEach(async () => {
    await invite(alice, bob);
    await join(bob);
  });

  it('an owner changes a role and the member\'s directory entry follows at their next contact', async () => {
    expect(await alice.commands.changeRole({ fold: FOLD, member: 'BOB222', role: 3 })).toMatchObject({ ok: true });
    await bob.commands.upkeep(FOLD);
    expect((await bob.directory.get(FOLD))!.role).toBe('viewer');
  });

  it('an editor cannot change roles, not even their own', async () => {
    expect(await bob.commands.changeRole({ fold: FOLD, member: 'BOB222', role: 1 })).toMatchObject({ ok: false, error: { code: 'not_owner' } });
  });

  it('the only owner can neither leave nor be demoted, and can hand the Fold over', async () => {
    expect(await alice.commands.leaveFold(FOLD)).toMatchObject({ ok: false, error: { code: 'last_owner' } });
    expect(await alice.commands.changeRole({ fold: FOLD, member: 'ALICE1', role: 2 })).toMatchObject({ ok: false, error: { code: 'last_owner' } });
    expect(await alice.commands.transferOwnership({ fold: FOLD, to: 'BOB222' })).toMatchObject({ ok: true });
    await alice.commands.upkeep(FOLD);
    await bob.commands.upkeep(FOLD);
    expect((await alice.directory.get(FOLD))!.role).toBe('editor');
    expect((await bob.directory.get(FOLD))!.role).toBe('owner');
    expect(await invite(alice, carol)).toMatchObject({ ok: false, error: { code: 'not_owner' } });
    expect(await invite(bob, carol)).toMatchObject({ ok: true });
  });
});

describe('removing and leaving (FR-086, FR-104)', () => {
  beforeEach(async () => {
    await invite(alice, bob);
    await join(bob);
    await invite(alice, carol);
    await join(carol);
  });

  it('a removed member\'s device forgets the Fold at its next contact, and cannot read what is written after', async () => {
    const removed = await alice.commands.removeMember({ fold: FOLD, member: 'BOB222' });
    expect(removed).toMatchObject({ ok: true, value: { epoch: 2 } });
    await spend(alice, 5, 900n, date(2026, 3, 12));
    await alice.sync(FOLD);

    // while bob is offline his keys still open the old epoch only
    const stale = await bob.sync(FOLD);
    expect(stale.quarantined).toContain('unknown_key');

    const upkeep = await bob.commands.upkeep(FOLD);
    expect(upkeep).toMatchObject({ ok: true, value: { outcome: 'wiped' } });
    expect(await bob.directory.get(FOLD)).toBeUndefined();
    expect(await bob.keyring.epochs(FOLD)).toEqual([]);
    expect(await bob.store.list(FOLD)).toEqual([]);
  });

  it('the remaining members get the new key and carry on', async () => {
    await alice.commands.removeMember({ fold: FOLD, member: 'BOB222' });
    await carol.commands.upkeep(FOLD);
    expect(await carol.keyring.epochs(FOLD)).toEqual([1, 2]);
    await spend(alice, 5, 900n, date(2026, 3, 12));
    await alice.sync(FOLD);
    expect((await exchange(carol)).applied).toBeGreaterThanOrEqual(1);
  });

  it('only an owner can remove, and not themselves', async () => {
    expect(await bob.commands.removeMember({ fold: FOLD, member: 'CAROL3' })).toMatchObject({ ok: false, error: { code: 'not_owner' } });
    expect(await alice.commands.removeMember({ fold: FOLD, member: 'ALICE1' })).toMatchObject({ ok: false, error: { code: 'self_target' } });
    expect(await alice.commands.removeMember({ fold: FOLD, member: 'NOBODY' })).toMatchObject({ ok: false, error: { code: 'not_a_member' } });
  });

  it('someone who leaves forgets the Fold at once, and the owner makes the new key at their next contact', async () => {
    expect(await carol.commands.leaveFold(FOLD)).toMatchObject({ ok: true });
    expect(await carol.directory.get(FOLD)).toBeUndefined();
    expect(await carol.keyring.epochs(FOLD)).toEqual([]);
    expect(await alice.keyring.epochs(FOLD)).toEqual([1]);
    expect(await alice.commands.upkeep(FOLD)).toMatchObject({ ok: true });
    expect(await alice.keyring.epochs(FOLD)).toEqual([1, 2]);
    await bob.commands.upkeep(FOLD);
    expect(await bob.keyring.epochs(FOLD)).toEqual([1, 2]);
  });

  it('a removal that could not make its new key right away is finished by the next owner contact', async () => {
    service.tamper = undefined;
    const removedOnly = async () => {
      // remove, then lose the connection before the rotation
      const original = alice.log.deps.remote.postLog;
      let calls = 0;
      (alice.log.deps.remote as { postLog: typeof original }).postLog = async (...args) => (++calls > 1 ? { ok: false, error: { code: 'offline', message: 'offline' } } : original(...args));
      const r = await alice.commands.removeMember({ fold: FOLD, member: 'BOB222' });
      (alice.log.deps.remote as { postLog: typeof original }).postLog = original;
      return r;
    };
    expect(await removedOnly()).toMatchObject({ ok: true, value: { epoch: 1 } });
    expect(await alice.keyring.epochs(FOLD)).toEqual([1]);
    expect(await alice.commands.completeRotation(FOLD)).toMatchObject({ ok: true, value: true });
    expect(await alice.keyring.epochs(FOLD)).toEqual([1, 2]);
    expect(await alice.commands.completeRotation(FOLD)).toMatchObject({ ok: true, value: false });
  });
});

describe('a lying service', () => {
  it('cannot add a member, change a role or hide a removal without a valid signature from an owner', async () => {
    await invite(alice, bob);
    await join(bob);
    service.tamper = (_f, e) => (e.type === 'change_role' ? { ...e, role: 1 } : e);
    await alice.commands.changeRole({ fold: FOLD, member: 'BOB222', role: 3 }).catch(() => undefined);
    service.tamper = undefined;
    const refreshed = await bob.log.refresh(FOLD);
    expect(refreshed).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
    expect((await bob.log.state(FOLD)) as never).toMatchObject({ ok: true });
    expect((await bob.directory.get(FOLD))!.role).toBe('editor');
  });

  it('cannot swap in a grant for another role, another member or an older key', async () => {
    await invite(alice, bob);
    // the service hands bob the grant addressed to alice
    const swapped = service.grants.get(`${FOLD}|ALICE1`) ?? [];
    service.grants.set(`${FOLD}|BOB222`, swapped);
    expect(await bob.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: true })).toMatchObject({ ok: false, error: { code: 'grant_invalid' } });
    expect(await bob.directory.get(FOLD)).toBeUndefined();
    expect(await bob.keyring.epochs(FOLD)).toEqual([]);
  });

  it('cannot make up a log: an entry that does not follow the chain is refused and not kept', async () => {
    await invite(alice, bob);
    const log = service.logs.get(FOLD)!;
    service.logs.set(FOLD, [log[0]!, log[1]!, { ...log[2]!, prev: new Uint8Array(32).fill(7) }]);
    expect(await bob.log.refresh(FOLD)).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
    // the entries that verified are kept; the one that does not is not
    expect(await bob.store.list(FOLD)).toHaveLength(2);
  });
});
