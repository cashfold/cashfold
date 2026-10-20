import { beforeEach, describe, expect, it } from 'vitest';
import { accountBalance } from '../../ledger/application/balance';
import { accountFieldPatch } from '../../ledger/domain/account';
import { TABLE } from '../../ledger/domain/tables';
import { transactionFieldPatch } from '../../ledger/domain/transaction';
import type { WireOp } from '../../sync/ports/index';
import { createParticipant, date, FakeService, id, logCrypto, worldFold, type Participant } from '../../testing/index';
import type { MembershipEntry } from '../domain/membership-log';

// Who may write, and who may read (FR-085, FR-086, FR-088): every member decides for themselves from the verified log, and
// a service that carries forged traffic cannot change the outcome.

let service: FakeService;
let alice: Participant, bob: Participant, carol: Participant;
const FOLD = worldFold(2);
const ACCOUNT = id(0x301);
const WALL = 1_800_000_000_000;

beforeEach(async () => {
  service = new FakeService();
  [alice, bob, carol] = [await createParticipant(service, 'ALICE1', 0xa1), await createParticipant(service, 'BOB222', 0xb1), await createParticipant(service, 'CAROL3', 0xc1)];
  await alice.createFold(FOLD);
  const r = await alice.writePath.submit({
    fold: FOLD, rec: ACCOUNT, table: TABLE.account, sets: new Map(),
    fields: accountFieldPatch({ kind: 'checking', name: 'Main', currency: 'USD' as never, openingBalanceMinor: 100_000n, openingDate: date(2020, 1, 1), includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false }),
  });
  expect(r.ok).toBe(true);
  await alice.sync(FOLD);
});

/** Time passes between steps, so log entries and ops have distinct times. */
const later = (ms = 100_000) => [alice, bob, carol].forEach((p) => (p.now += ms));

const exchange = async (p: Participant) => {
  await p.commands.upkeep(FOLD);
  return p.sync(FOLD);
};

async function admit(who: Participant, role: 1 | 2 | 3 = 2) {
  const sent = await alice.commands.inviteMember({ fold: FOLD, bundle: await who.bundle(), role, scope: 'full', fingerprintConfirmed: true });
  expect(sent.ok).toBe(true);
  const accepted = await who.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: true });
  expect(accepted.ok).toBe(true);
  await exchange(who);
}

/** An op as a given device would write it, built by hand so no role check on the writer's side can stop it. */
const spendOp = (p: Participant, n: number, over: Partial<WireOp> = {}, epoch = 1): WireOp => ({
  fold: FOLD, op: id(0x7000 + n), rec: id(0x700 + n), dev: p.person.device, seq: BigInt(100 + n), hlc: { wallMs: WALL, ctr: n }, epoch, schema: 1, table: TABLE.transaction, sets: new Map(),
  fields: transactionFieldPatch({
    accountId: ACCOUNT, direction: 'expense', amountMinor: -250n, currency: 'USD' as never, baseAmountMinor: -250n, baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null,
    occurredUtcMs: WALL, tzOffsetMin: 0, localDate: date(2026, 3, 4), status: 'posted', note: 'forged',
  }),
  ...over,
});

const push = async (p: Participant, op: WireOp) => service.relay.push(FOLD, [await p.forge(op)]);
const balance = async (p: Participant) => {
  const b = accountBalance(await p.ledger(FOLD), ACCOUNT);
  return b.ok ? b.value : undefined;
};

describe('forged writes', () => {
  beforeEach(async () => {
    await admit(bob, 3); // a viewer
    await admit(carol, 2);
    later();
  });

  it('an op from a viewer is set aside by every other member', async () => {
    await exchange(alice);
    await push(bob, spendOp(bob, 1));
    const [forAlice, forCarol] = [await exchange(alice), await exchange(carol)];
    expect(forAlice.quarantined).toContain('unauthorised');
    expect(forCarol.quarantined).toContain('unauthorised');
    expect(await balance(alice)).toBe(100_000n);
    expect(await balance(carol)).toBe(100_000n);
  });

  it('an op from an editor is applied by everyone', async () => {
    await exchange(alice);
    await push(carol, spendOp(carol, 2));
    expect((await exchange(alice)).quarantined).toEqual([]);
    expect(await balance(alice)).toBe(99_750n);
    await exchange(bob);
    expect(await balance(bob)).toBe(99_750n);
  });

  it('a role change takes effect from the time it was made: later ops from the demoted member are set aside, earlier ones stand', async () => {
    await alice.commands.changeRole({ fold: FOLD, member: 'CAROL3', role: 3 });
    const changedAt = (await alice.store.list(FOLD)).at(-1)!.ts;
    await exchange(alice);
    await push(carol, spendOp(carol, 3, { hlc: { wallMs: changedAt - 10, ctr: 0 } }));
    await push(carol, spendOp(carol, 4, { hlc: { wallMs: changedAt + 10, ctr: 0 } }));
    const report = await exchange(alice);
    expect(report.applied).toBe(1);
    expect(report.quarantined).toEqual(['unauthorised']);
    expect(await balance(alice)).toBe(99_750n);
  });

  it('an op from a device nobody certified is not stored, so it can be applied once the log says whose device it is', async () => {
    const stranger = await createParticipant(service, 'MALLORY', 0xe1);
    // someone who has the Fold's key but whose device the log never certified
    await stranger.keyring.importFoldKey(FOLD, 1, alice.keyring.secret(FOLD, 1)!);
    await exchange(alice);
    await push(stranger, spendOp(stranger, 5));
    const report = await exchange(alice);
    expect(report.quarantined).toContain('unknown_signer');
    expect((await alice.oplog.listQuarantined(FOLD)).map((q) => q.reason)).not.toContain('unknown_signer');
    expect(await balance(alice)).toBe(100_000n);
  });

  it('a device stops being believed from the moment it was revoked', async () => {
    // revoke carol's own device: later ops signed by it are not believed, earlier ones are
    carol.devices[0] = { ...carol.devices[0]!, revoked: true };
    await carol.commands.certifyDevices(FOLD);
    later();
    await exchange(alice);
    const revokedAt = (await alice.store.list(FOLD)).at(-1)!.ts;
    await push(carol, spendOp(carol, 6, { hlc: { wallMs: revokedAt - 5, ctr: 0 } }));
    await push(carol, spendOp(carol, 7, { hlc: { wallMs: revokedAt + 5, ctr: 0 } }));
    const report = await exchange(alice);
    expect(report.applied).toBe(1);
    expect(report.quarantined).toEqual(['unauthorised']);
  });
});

describe('forged log entries', () => {
  beforeEach(async () => {
    await admit(bob, 2);
    await admit(carol, 3);
  });

  const forge = async (by: Participant, draft: Omit<MembershipEntry, 'idx' | 'prev' | 'signer' | 'ts' | 'sig'>): Promise<MembershipEntry> => {
    const entries = service.logs.get(FOLD)!;
    const last = entries.at(-1)!;
    return logCrypto.sign({ ...draft, idx: entries.length, prev: await logCrypto.hash(last), signer: by.account, ts: last.ts + 1 }, by.person.sig.secretKey) as Promise<MembershipEntry>;
  };

  it('an editor cannot promote themselves: the entry is refused by every member that reads it', async () => {
    const entry = await forge(bob, { type: 'change_role', subject: 'BOB222', role: 1 });
    service.logs.set(FOLD, [...service.logs.get(FOLD)!, entry]);
    expect(await alice.log.refresh(FOLD)).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
    expect(await carol.log.refresh(FOLD)).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
    const state = await alice.log.state(FOLD);
    expect(state.ok && state.value.members.get('BOB222')?.role).toBe(2);
  });

  it('an editor cannot add anyone or remove an owner', async () => {
    const mallory = await createParticipant(service, 'MALLORY', 0xe1);
    const add = await forge(bob, { type: 'add_member', subject: 'MALLORY', role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: mallory.person.enc.publicKey, sig: mallory.person.sig.publicKey } });
    service.logs.set(FOLD, [...service.logs.get(FOLD)!, add]);
    expect(await alice.log.refresh(FOLD)).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
    service.logs.set(FOLD, service.logs.get(FOLD)!.slice(0, -1));
    const remove = await forge(bob, { type: 'remove_member', subject: 'ALICE1' });
    service.logs.set(FOLD, [...service.logs.get(FOLD)!, remove]);
    expect(await carol.log.refresh(FOLD)).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
  });

  it('the last owner cannot be removed, demoted or leave, even by themselves', async () => {
    expect(await alice.commands.leaveFold(FOLD)).toMatchObject({ ok: false, error: { code: 'last_owner' } });
    const demote = await forge(alice, { type: 'change_role', subject: 'ALICE1', role: 2 });
    service.logs.set(FOLD, [...service.logs.get(FOLD)!, demote]);
    expect(await bob.log.refresh(FOLD)).toMatchObject({ ok: false, error: { code: 'log_invalid' } });
  });

  it('a log whose first entry is not the creator\'s is refused outright', async () => {
    const eve = await createParticipant(service, 'EVE999', 0xe2);
    const first = await logCrypto.sign({ idx: 0, prev: new Uint8Array(32), type: 'add_member', subject: 'EVE999', role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: eve.person.enc.publicKey, sig: eve.person.sig.publicKey }, signer: 'EVE999', ts: 5 }, eve.person.sig.secretKey);
    service.logs.set(FOLD, [first as MembershipEntry]);
    // carol's local log already starts with alice; a replacement log that differs from it cannot be extended
    expect(await carol.log.refresh(FOLD)).toMatchObject({ ok: false });
  });
});

describe('reading', () => {
  it('a removed member cannot open anything written under the new key, and is given no grant for it', async () => {
    await admit(bob, 2);
    await admit(carol, 2);
    await alice.commands.removeMember({ fold: FOLD, member: 'BOB222' });
    await alice.writePath.submit({ fold: FOLD, rec: id(0x800), table: TABLE.tag, fields: new Map([[1, 'secret tag']]), sets: new Map() });
    await alice.sync(FOLD);

    const report = await bob.sync(FOLD); // bob has not noticed yet; he only has epoch 1
    expect(report.quarantined).toContain('unknown_key');
    expect(await bob.keyring.key(FOLD, 2)).toBeUndefined();
    expect(await bob.log.deps.remote.fetchGrants(FOLD)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await bob.commands.upkeep(FOLD)).toMatchObject({ ok: true, value: { outcome: 'wiped' } });
    expect(await bob.keyring.epochs(FOLD)).toEqual([]);
  });

  it('what a removed member writes with the old key after the removal is set aside by the others', async () => {
    await admit(bob, 2);
    await admit(carol, 2);
    later();
    await alice.commands.removeMember({ fold: FOLD, member: 'BOB222' });
    const removedAt = (await alice.store.list(FOLD)).find((e) => e.type === 'remove_member')!.ts;
    await push(bob, spendOp(bob, 8, { hlc: { wallMs: removedAt + 100, ctr: 0 } }));
    await push(bob, spendOp(bob, 9, { hlc: { wallMs: removedAt - 100, ctr: 0 } }));
    const report = await exchange(carol);
    expect(report.quarantined).toEqual(['unauthorised']);
    expect(report.applied).toBeGreaterThanOrEqual(1); // the one written before the removal stands
  });

  it('a member who joined from now on holds only the new key, and cannot be given the old ones later by the same invitation', async () => {
    await alice.commands.inviteMember({ fold: FOLD, bundle: await carol.bundle(), role: 2, scope: 'from_join', fingerprintConfirmed: true });
    await carol.commands.acceptInvitation({ fold: FOLD, inviterFingerprintConfirmed: true });
    expect(await carol.keyring.epochs(FOLD)).toEqual([2]);
    expect(await alice.commands.inviteMember({ fold: FOLD, bundle: await carol.bundle(), role: 2, scope: 'full', fingerprintConfirmed: true })).toMatchObject({ ok: false, error: { code: 'already_member' } });
    expect(await carol.keyring.epochs(FOLD)).toEqual([2]);
  });
});
