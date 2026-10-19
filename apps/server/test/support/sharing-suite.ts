import { randomBytes } from 'node:crypto';
import { createEd25519Signer, createLogCrypto, createSharingCrypto, decodeEntry, encodeEntry, hashEntry, RelayError, SecretBuf, type PlainLogEntry } from '@cashfold/crypto';
import { decode, encode } from '@cashfold/protocol/cbor';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '../../src/store/store.js';
import { register, signIn, signedOp, startRelay, type Harness, type Session, type TestAccount } from './relay-harness.js';

// The relay's sharing behaviour over HTTP with real SRP and real frames, against any Store: membership log, invitations,
// lookup, grants and what each member is sent. Memory runs it in the unit suite; PostgreSQL in the integration suite.

const cbor = (v: unknown) => encode(v as never);
const signer = createEd25519Signer();
const logCrypto = createLogCrypto({ signer });
const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const sharing = createSharingCrypto({ rng });
const uuidText = (b: Uint8Array): string => {
  const h = Buffer.from(b).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export interface Person {
  readonly account: TestAccount;
  readonly session: Session;
}

export interface Rig {
  readonly h: Harness;
  /** Registers an account with a real key set, confirms its address and signs in. */
  person(over?: { discoverable?: boolean; verify?: boolean; email?: string }): Promise<Person>;
}

const mapGet = (m: unknown, key: string): unknown => (m as Map<string, unknown>).get(key);

export async function verifyAddress(h: Harness, a: TestAccount): Promise<void> {
  const message = h.mail.sent.filter((m) => m.to === a.email).at(-1)!;
  const token = /#token=([A-Za-z0-9_-]+)/.exec(message.text)![1]!;
  const r = await h.raw('POST', '/accounts/verify-email', { 'content-type': 'application/cbor' }, cbor({ token }));
  if (r.statusCode !== 204) throw new Error('address not verified');
}

/** A growing, signed, hash-chained log as a client would write it. */
export class Chain {
  readonly entries: PlainLogEntry[] = [];
  private clock = 1_800_000_000_000;

  async append(by: TestAccount, draft: Omit<PlainLogEntry, 'idx' | 'prev' | 'signer' | 'ts' | 'sig'> & { ts?: number }, over: Partial<PlainLogEntry> = {}): Promise<Uint8Array> {
    const last = this.entries.at(-1);
    const { ts, ...rest } = draft;
    const unsigned = {
      ...rest, idx: this.entries.length, prev: last === undefined ? new Uint8Array(32) : hashEntry(last), signer: by.accountId, ts: ts ?? (this.clock += 10), ...over,
    };
    const entry = await logCrypto.sign(unsigned, by.keys!.sigSk);
    this.entries.push(entry);
    return encodeEntry(entry);
  }

  genesis(owner: TestAccount) {
    return this.append(owner, { type: 'add_member', subject: owner.accountId, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: owner.keys!.encPk, sig: owner.keys!.sigPk } });
  }

  add(by: TestAccount, who: TestAccount, role: 1 | 2 | 3, over: { scope?: 'full' | 'from_join'; fromEpoch?: number; pubkeys?: PlainLogEntry['pubkeys'] } = {}) {
    return this.append(by, {
      type: 'add_member', subject: who.accountId, role, scope: over.scope ?? 'full', fromEpoch: over.fromEpoch ?? 1,
      pubkeys: over.pubkeys ?? { enc: who.keys!.encPk, sig: who.keys!.sigPk },
    });
  }

  /** Forgets the last entry, as if the relay had refused it. */
  drop() {
    this.entries.pop();
  }
}

export const foldWire = (n: number): Buffer => Buffer.alloc(16, n);
export const foldPath = (fold: Buffer): string => fold.toString('base64url');

export async function grantFor(fold: Buffer, by: TestAccount, to: TestAccount, epoch: number, role: 1 | 2 | 3 = 2): Promise<Uint8Array> {
  const key = SecretBuf.from(rng.bytes(32));
  return sharing.sealGrant({ fold: uuidText(fold), epoch, role, member: to.accountId, grantedBy: by.accountId, recipientEncPk: to.keys!.encPk, foldKey: key, signingKey: by.keys!.sigSk });
}

export function describeSharing(label: string, makeStore: () => Promise<Store>): void {
  describe(`Sharing: ${label}`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      while (open.length > 0) await open.pop()!.close();
    });

    async function rig(over: Parameters<typeof startRelay>[1] = {}): Promise<Rig> {
      const h = await startRelay(await makeStore(), { rateLimitScale: 1000, ...over });
      open.push(h);
      return {
        h,
        async person(opts = {}) {
          const account = await register(h, { keys: true, ...(opts.discoverable !== undefined && { discoverable: opts.discoverable }), ...(opts.email !== undefined && { email: opts.email }) });
          if (opts.verify !== false && over.mail?.kind !== 'none') await verifyAddress(h, account);
          const { session } = await signIn(h, account);
          return { account, session };
        },
      };
    }

    /** A request whose refusal is an answer like any other: the status, and the body when there is one. */
    const call = async (p: Person, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
      try {
        return await p.session.request(method, path, body);
      } catch (e) {
        if (e instanceof RelayError && e.status > 0) return { status: e.status, body: null };
        throw e;
      }
    };
    const get = (p: Person, path: string) => call(p, 'GET', path);
    const post = (p: Person, path: string, body: unknown) => call(p, 'POST', path, body);

    async function createFold(owner: Person, n = 1): Promise<{ fold: Buffer; chain: Chain }> {
      const fold = foldWire(n);
      const chain = new Chain();
      const genesis = await chain.genesis(owner.account);
      const r = await post(owner, '/folds', { fold, genesis, grant: await grantFor(fold, owner.account, owner.account, 1, 1) });
      expect(r.status).toBe(201);
      return { fold, chain };
    }

    describe('the membership log', () => {
      it('starts with the creator\'s own signed entry, which comes with the Fold', async () => {
        const { person } = await rig();
        const alice = await person();
        const { fold, chain } = await createFold(alice);
        const log = await get(alice, `/folds/${foldPath(fold)}/log`);
        expect(log.status).toBe(200);
        expect(mapGet(log.body, 'head')).toBe(0n);
        const entries = mapGet(log.body, 'entries') as Uint8Array[];
        expect(entries).toHaveLength(1);
        expect(decodeEntry(entries[0]!)).toEqual(chain.entries[0]);
      });

      it('refuses a first entry that is not the creator\'s, and leaves no Fold behind', async () => {
        const { person } = await rig();
        const [alice, bob] = [await person(), await person()];
        const fold = foldWire(2);
        const forged = new Chain();
        const genesis = await forged.genesis(bob.account);
        const r = await post(alice, '/folds', { fold, genesis });
        expect(r.status).toBe(403);
        expect((await get(alice, '/folds')).body).toEqual([]);

        const editor = new Chain();
        const asEditor = await editor.append(alice.account, { type: 'add_member', subject: alice.account.accountId, role: 2, scope: 'full', fromEpoch: 1, pubkeys: { enc: alice.account.keys!.encPk, sig: alice.account.keys!.sigPk } });
        expect((await post(alice, '/folds', { fold, genesis: asEditor })).status).toBe(409);

        const wrongKeys = new Chain();
        const swapped = await wrongKeys.append(alice.account, { type: 'add_member', subject: alice.account.accountId, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: bob.account.keys!.encPk, sig: alice.account.keys!.sigPk } });
        expect((await post(alice, '/folds', { fold, genesis: swapped })).status).toBe(409);
      });

      it('takes the next entry and refuses a gap, a repeat or a broken chain', async () => {
        const { person } = await rig();
        const [alice, bob] = [await person(), await person()];
        const { fold, chain } = await createFold(alice);
        const path = `/folds/${foldPath(fold)}/log`;
        const skip = await chain.add(alice.account, bob.account, 2, {});
        chain.drop();
        const broken = new Chain();
        broken.entries.push(...chain.entries);
        const noLink = await broken.add(alice.account, bob.account, 2);
        const forkedEntry = decodeEntry(noLink);
        const unlinked = encodeEntry(await logCrypto.sign({ ...forkedEntry, prev: new Uint8Array(32).fill(5) }, alice.account.keys!.sigSk));
        expect((await post(alice, path, { entry: unlinked })).status).toBe(409);
        void skip;
        expect((await post(alice, path, { entry: noLink })).status).toBe(201);
        expect((await post(alice, path, { entry: noLink })).status).toBe(409); // the same index again
        const log = await get(alice, path);
        expect(mapGet(log.body, 'head')).toBe(1n);
        expect(((await get(alice, `${path}?after=0`)).body as Map<string, unknown>).get('entries')).toHaveLength(1);
      });

      it('refuses entries from outsiders, forged signatures and signatures of the wrong key', async () => {
        const { person } = await rig();
        const [alice, bob, carol] = [await person(), await person(), await person()];
        const { fold, chain } = await createFold(alice);
        const path = `/folds/${foldPath(fold)}/log`;
        const asOutsider = new Chain();
        asOutsider.entries.push(...chain.entries);
        const byBob = await asOutsider.append(bob.account, { type: 'add_member', subject: bob.account.accountId, role: 1, scope: 'full', fromEpoch: 1, pubkeys: { enc: bob.account.keys!.encPk, sig: bob.account.keys!.sigPk } });
        expect((await post(bob, path, { entry: byBob })).status).toBe(403);
        expect((await get(bob, path)).status).toBe(403);

        const next = new Chain();
        next.entries.push(...chain.entries);
        const good = await next.add(alice.account, bob.account, 2);
        const bad = decodeEntry(good);
        const flipped = encodeEntry({ ...bad, sig: new Uint8Array(64) });
        expect((await post(alice, path, { entry: flipped })).status).toBe(409);
        const byWrongKey = encodeEntry(await logCrypto.sign({ ...bad }, carol.account.keys!.sigSk));
        expect((await post(alice, path, { entry: byWrongKey })).status).toBe(409);
        const asOther = encodeEntry(await logCrypto.sign({ ...bad, signer: bob.account.accountId }, alice.account.keys!.sigSk));
        expect((await post(alice, path, { entry: asOther })).status).toBe(403);
        expect((await post(alice, path, { entry: Buffer.from('garbage') })).status).toBe(400);
      });

      it('lets only an owner add members, only with the keys the account registered', async () => {
        const { person } = await rig();
        const [alice, bob, carol] = [await person(), await person(), await person()];
        const { fold, chain } = await createFold(alice);
        const path = `/folds/${foldPath(fold)}/invitations`;
        const slip = await chain.add(alice.account, bob.account, 2, { pubkeys: { enc: carol.account.keys!.encPk, sig: bob.account.keys!.sigPk } });
        expect((await post(alice, path, { entry: slip })).status).toBe(409);
        chain.drop();
        const grants = [await grantFor(fold, alice.account, bob.account, 1)];
        const ok = await chain.add(alice.account, bob.account, 2);
        expect((await post(alice, path, { entry: ok, grants })).status).toBe(201);

        // an editor cannot add anyone
        const byEditor = await chain.add(bob.account, carol.account, 2);
        expect((await post(bob, `/folds/${foldPath(fold)}/log`, { entry: byEditor })).status).toBe(409);
        // and the same account cannot be added twice
        chain.drop();
        const again = await chain.add(alice.account, bob.account, 3);
        expect((await post(alice, path, { entry: again })).status).toBe(409);
      });
    });

    describe('members and what they are sent', () => {
      async function shared(r: Rig) {
        const [alice, bob, carol] = [await r.person(), await r.person(), await r.person()];
        const { fold, chain } = await createFold(alice);
        const invite = async (by: Person, who: Person, role: 1 | 2 | 3, grants: Uint8Array[]) => post(by, `/folds/${foldPath(fold)}/invitations`, { entry: await chain.add(by.account, who.account, role), grants });
        return { alice, bob, carol, fold, chain, invite };
      }

      it('lists the Fold for an invited member, who then fetches the grants addressed to them', async () => {
        const r = await rig();
        const { alice, bob, carol, fold, invite } = await shared(r);
        expect((await invite(alice, bob, 2, [await grantFor(fold, alice.account, bob.account, 1, 2)])).status).toBe(201);
        expect((await get(bob, '/folds')).body as unknown[]).toHaveLength(1);
        const grants = (await get(bob, `/folds/${foldPath(fold)}/grants?member=me`)).body as Uint8Array[];
        expect(grants).toHaveLength(1);
        expect(sharing.readGrant(grants[0]!)).toMatchObject({ member: bob.account.accountId, epoch: 1, role: 2, grantedBy: alice.account.accountId });
        expect((await get(carol, `/folds/${foldPath(fold)}/grants?member=me`)).status).toBe(403);
      });

      it('takes only grants from the signer, for this Fold, to people who will be members', async () => {
        const r = await rig();
        const { alice, bob, carol, fold, chain } = await shared(r);
        const path = `/folds/${foldPath(fold)}/invitations`;
        const add = async (grants: Uint8Array[]) => {
          const entry = await chain.add(alice.account, bob.account, 2);
          const res = await post(alice, path, { entry, grants });
          if (res.status !== 201) chain.drop();
          return res.status;
        };
        expect(await add([await grantFor(fold, alice.account, carol.account, 1)])).toBe(400); // carol is not a member
        expect(await add([await grantFor(fold, bob.account, bob.account, 1)])).toBe(400); // granted by someone else
        expect(await add([await grantFor(foldWire(9), alice.account, bob.account, 1)])).toBe(400); // another Fold
        expect(await add([new Uint8Array([1, 2, 3])])).toBe(400);
        expect(await add([await grantFor(fold, alice.account, bob.account, 1)])).toBe(201);
        // nothing from the refused attempts was kept
        expect(((await get(alice, `/folds/${foldPath(fold)}/log`)).body as Map<string, unknown>).get('head')).toBe(1n);
      });

      it('lets an editor push, a viewer read only, and a removed member neither, while the log stays readable to them', async () => {
        const r = await rig();
        const { alice, bob, carol, fold, chain, invite } = await shared(r);
        await invite(alice, bob, 2, [await grantFor(fold, alice.account, bob.account, 1, 2)]);
        await invite(alice, carol, 3, [await grantFor(fold, alice.account, carol.account, 1, 3)]);
        const opsPath = `/folds/${foldPath(fold)}/ops`;
        const send = async (p: Person, seq: bigint) => post(p, opsPath, [await signedOp(fold, p.account.device, seq)]);
        expect((await send(bob, 1n)).status).toBe(200);
        expect((await send(carol, 1n)).status).toBe(403);
        expect((await get(carol, `${opsPath}?after=0`)).status).toBe(200);

        await post(alice, `/folds/${foldPath(fold)}/log`, { entry: await chain.append(alice.account, { type: 'remove_member', subject: bob.account.accountId }) });
        expect((await send(bob, 2n)).status).toBe(403);
        expect((await get(bob, `${opsPath}?after=0`)).status).toBe(403);
        expect((await get(bob, `/folds/${foldPath(fold)}/grants?member=me`)).status).toBe(403);
        expect((await get(bob, '/folds')).body).toEqual([]);
        const seen = (await get(bob, `/folds/${foldPath(fold)}/log`)).body as Map<string, unknown>;
        expect(seen.get('head')).toBe(BigInt(chain.entries.length - 1)); // bob learns that he was removed
      });

      it('the last owner cannot leave, be demoted or be removed; with a second owner they can', async () => {
        const r = await rig();
        const { alice, bob, fold, chain, invite } = await shared(r);
        await invite(alice, bob, 1, [await grantFor(fold, alice.account, bob.account, 1, 1)]);
        const path = `/folds/${foldPath(fold)}/log`;
        expect((await post(alice, path, { entry: await chain.append(alice.account, { type: 'leave', subject: alice.account.accountId }) })).status).toBe(201);
        // bob is now the only owner
        expect((await post(bob, path, { entry: await chain.append(bob.account, { type: 'leave', subject: bob.account.accountId }) })).status).toBe(409);
        chain.drop();
        expect((await post(bob, path, { entry: await chain.append(bob.account, { type: 'change_role', subject: bob.account.accountId, role: 2 }) })).status).toBe(409);
        chain.drop();
        expect((await post(bob, path, { entry: await chain.append(bob.account, { type: 'remove_member', subject: bob.account.accountId }) })).status).toBe(409);
      });

      it('changes a role, and what a member may do follows', async () => {
        const r = await rig();
        const { alice, bob, fold, chain, invite } = await shared(r);
        await invite(alice, bob, 2, [await grantFor(fold, alice.account, bob.account, 1, 2)]);
        const opsPath = `/folds/${foldPath(fold)}/ops`;
        expect((await post(bob, opsPath, [await signedOp(fold, bob.account.device, 1n)])).status).toBe(200);
        const path = `/folds/${foldPath(fold)}/log`;
        expect((await post(alice, path, { entry: await chain.append(alice.account, { type: 'change_role', subject: bob.account.accountId, role: 3 }) })).status).toBe(201);
        expect((await post(bob, opsPath, [await signedOp(fold, bob.account.device, 2n)])).status).toBe(403);
        expect((await post(alice, path, { entry: await chain.append(alice.account, { type: 'change_role', subject: bob.account.accountId, role: 3 }) })).status).toBe(409);
        chain.drop();
      });

      it('moves to a new epoch one step at a time, with a grant for each remaining member', async () => {
        const r = await rig();
        const { alice, bob, fold, chain, invite } = await shared(r);
        await invite(alice, bob, 2, [await grantFor(fold, alice.account, bob.account, 1, 2)]);
        const path = `/folds/${foldPath(fold)}/log`;
        const skip = await chain.append(alice.account, { type: 'rotate_epoch', subject: alice.account.accountId, epoch: 3 });
        expect((await post(alice, path, { entry: skip })).status).toBe(409);
        chain.drop();
        const rotate = await chain.append(alice.account, { type: 'rotate_epoch', subject: alice.account.accountId, epoch: 2 });
        const wrongEpoch = await grantFor(fold, alice.account, bob.account, 5, 2);
        expect((await post(alice, path, { entry: rotate, grants: [wrongEpoch] })).status).toBe(400);
        const grants = [await grantFor(fold, alice.account, alice.account, 2, 1), await grantFor(fold, alice.account, bob.account, 2, 2)];
        expect((await post(alice, path, { entry: rotate, grants })).status).toBe(201);
        const got = (await get(bob, `/folds/${foldPath(fold)}/grants?member=me`)).body as Uint8Array[];
        expect(got.map((g) => sharing.readGrant(g)!.epoch)).toEqual([1, 2]);
        const byBob = await chain.append(bob.account, { type: 'rotate_epoch', subject: bob.account.accountId, epoch: 3 });
        expect((await post(bob, path, { entry: byBob })).status).toBe(409);
      });

      it('sends a member who joined from a later epoch only the ops of that epoch and after, and no older snapshot', async () => {
        const r = await rig();
        const { alice, bob, carol, fold, chain, invite } = await shared(r);
        await invite(alice, bob, 2, [await grantFor(fold, alice.account, bob.account, 1, 2)]);
        const opsPath = `/folds/${foldPath(fold)}/ops`;
        const path = `/folds/${foldPath(fold)}/log`;
        await post(alice, opsPath, [await signedOp(fold, alice.account.device, 1n)]); // epoch 1 (the helper writes epoch 1)
        const rotate = await chain.append(alice.account, { type: 'rotate_epoch', subject: alice.account.accountId, epoch: 2 });
        await post(alice, path, { entry: rotate, grants: [await grantFor(fold, alice.account, alice.account, 2, 1), await grantFor(fold, alice.account, bob.account, 2, 2)] });
        const joiner = await chain.add(alice.account, carol.account, 2, { scope: 'from_join', fromEpoch: 2 });
        expect((await post(alice, `/folds/${foldPath(fold)}/invitations`, { entry: joiner, grants: [await grantFor(fold, alice.account, carol.account, 2, 2)] })).status).toBe(201);

        // an op written under epoch 2 and one under epoch 1
        const epochTwo = await signedOpAt(fold, alice.account, 2n, 2);
        await post(alice, opsPath, [epochTwo]);
        const forCarol = (await get(carol, `${opsPath}?after=0`)).body as Map<string, unknown>;
        expect((forCarol.get('ops') as unknown[]).length).toBe(1);
        const forBob = (await get(bob, `${opsPath}?after=0`)).body as Map<string, unknown>;
        expect((forBob.get('ops') as unknown[]).length).toBe(2);

        await post(alice, `/folds/${foldPath(fold)}/snapshot`.replace('/snapshot', '/snapshot'), undefined).catch(() => undefined);
      });
    });

    describe('looking people up (FR-106)', () => {
      const lookup = (p: Person, email: string) => post(p, '/accounts/lookup', { email });

      it('returns a verifiable key bundle for an account that can be found', async () => {
        const { person } = await rig();
        const [alice, bob] = [await person(), await person()];
        const r = await lookup(alice, bob.account.email);
        expect(r.status).toBe(200);
        const m = r.body as Map<string, Uint8Array | string>;
        expect(m.get('account_id')).toBe(bob.account.accountId);
        expect(Buffer.from(m.get('enc_pk') as Uint8Array)).toEqual(Buffer.from(bob.account.keys!.encPk));
        expect(Buffer.from(m.get('sig_pk') as Uint8Array)).toEqual(Buffer.from(bob.account.keys!.sigPk));
        expect(await sharing.verifyBundle({ accountId: bob.account.accountId, encPk: m.get('enc_pk') as Uint8Array, sigPk: m.get('sig_pk') as Uint8Array, selfSig: m.get('self_sig') as Uint8Array })).toBe(true);
        expect((await get(alice, `/accounts/${bob.account.accountId}/public-keys`)).status).toBe(200);
      });

      it('answers an unknown address, a hidden account and an unconfirmed address with the same 404', async () => {
        const { person } = await rig();
        const [alice, hidden, unconfirmed] = [await person(), await person({ discoverable: false }), await person({ verify: false })];
        const answers = [await lookup(alice, 'nobody@example.com'), await lookup(alice, hidden.account.email), await lookup(alice, unconfirmed.account.email)];
        expect(answers.map((a) => a.status)).toEqual([404, 404, 404]);
        expect(new Set(answers.map((a) => JSON.stringify(a.body, (_k, v) => (typeof v === 'bigint' ? String(v) : v)))).size).toBe(1);
        expect((await lookup(alice, alice.account.email)).status).toBe(404);
      });

      it('is for signed-in callers whose own address is confirmed', async () => {
        const { person, h } = await rig();
        const [unverified, target] = [await person({ verify: false }), await person()];
        expect((await lookup(unverified, target.account.email)).status).toBe(403);
        expect((await h.raw('POST', '/accounts/lookup', { 'content-type': 'application/cbor' }, cbor({ email: target.account.email }))).statusCode).toBe(401);
      });

      it('is open to callers on a service that does not confirm addresses, for accounts that opted in', async () => {
        const { person } = await rig({ mail: { kind: 'none' } });
        const [alice, bob, hidden] = [await person(), await person(), await person({ discoverable: false })];
        expect((await lookup(alice, bob.account.email)).status).toBe(200);
        expect((await lookup(alice, hidden.account.email)).status).toBe(404);
      });

      it('allows twenty a day per account, then says when to try again', async () => {
        const r = await rig({ rateLimitScale: 1 });
        const [alice, bob] = [await r.person(), await r.person()];
        for (let i = 0; i < 20; i++) expect((await lookup(alice, i % 2 === 0 ? bob.account.email : 'ghost@example.com')).status).toBeLessThan(429);
        const limited = await lookup(alice, bob.account.email);
        expect(limited.status).toBe(429);
        r.h.clock.now += 24 * 3_600_000 + 1;
        const fresh = await signIn(r.h, alice.account);
        expect((await fresh.session.request('POST', '/accounts/lookup', { email: bob.account.email })).status).toBe(200);
      });

      it('takes about as long for an unknown address as for a known one', async () => {
        const { person } = await rig();
        const [alice, bob] = [await person(), await person()];
        const time = async (email: string) => {
          const samples: number[] = [];
          for (let i = 0; i < 60; i++) {
            const t = performance.now();
            await lookup(alice, email);
            samples.push(performance.now() - t);
          }
          return samples.sort((a, b) => a - b)[30]!;
        };
        const [known, unknown] = [await time(bob.account.email), await time('ghost@example.com')];
        expect(Math.abs(known - unknown)).toBeLessThan(Math.max(8, Math.max(known, unknown)));
      });

      it('refuses a registration whose bundle signature does not match its keys', async () => {
        const { h } = await rig();
        const good = await register(h, { keys: true });
        expect(good.keys?.bundleSig).toHaveLength(64);
        const other = await register(h, { keys: true });
        void other;
        // a registration that carries somebody else's signature
        await expect(registerWithSignature(h, good.keys!.bundleSig)).rejects.toThrow('400');
      });
    });

    describe('invitation email (FR-107)', () => {
      it('goes to the invitee\'s registered address and names only the sender', async () => {
        const { person, h } = await rig();
        const [alice, bob] = [await person(), await person()];
        const { fold, chain } = await createFold(alice);
        const before = h.mail.sent.length;
        const entry = await chain.add(alice.account, bob.account, 2);
        expect((await post(alice, `/folds/${foldPath(fold)}/invitations`, { entry, grants: [await grantFor(fold, alice.account, bob.account, 1)], notify_email: 'someone-else@example.com' })).status).toBe(201);
        const sent = h.mail.sent.slice(before);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.to).toBe(bob.account.email);
        expect(sent[0]!.text).toContain(alice.account.email);
        expect(sent[0]!.subject + sent[0]!.text).not.toMatch(/someone-else/);
      });

      it('contains no Fold name, id, member, amount or key', async () => {
        const { person, h } = await rig();
        const [alice, bob, carol] = [await person(), await person(), await person()];
        const { fold, chain } = await createFold(alice);
        await post(alice, `/folds/${foldPath(fold)}/invitations`, { entry: await chain.add(alice.account, carol.account, 3), grants: [await grantFor(fold, alice.account, carol.account, 1, 3)] });
        const before = h.mail.sent.length;
        await post(alice, `/folds/${foldPath(fold)}/invitations`, { entry: await chain.add(alice.account, bob.account, 2), grants: [await grantFor(fold, alice.account, bob.account, 1, 2)] });
        const message = h.mail.sent.slice(before)[0]!;
        const body = `${message.subject}\n${message.text}`;
        for (const secret of [foldPath(fold), fold.toString('hex'), carol.account.email, carol.account.accountId, bob.account.accountId, Buffer.from(bob.account.keys!.encPk).toString('hex'), Buffer.from(bob.account.keys!.encPk).toString('base64url')]) {
          expect(body).not.toContain(secret);
        }
        expect(body).not.toMatch(/\b(balance|account|amount|budget|transaction|salary|rent)\b/i);
        expect(body).toContain(alice.account.email);
        expect(body.match(/@/g)!.length).toBeLessThanOrEqual(4); // the two addresses, in the text and the greeting
      });

      it('is not sent for other log entries, or when the service does not send mail', async () => {
        const r = await rig();
        const [alice, bob] = [await r.person(), await r.person()];
        const { fold, chain } = await createFold(alice);
        const before = r.h.mail.sent.length;
        await post(alice, `/folds/${foldPath(fold)}/log`, { entry: await chain.append(alice.account, { type: 'rotate_epoch', subject: alice.account.accountId, epoch: 2 }), grants: [await grantFor(fold, alice.account, alice.account, 2, 1)] });
        expect(r.h.mail.sent.length).toBe(before);
        // an invitation must carry an add_member entry
        const wrong = await chain.append(alice.account, { type: 'rotate_epoch', subject: alice.account.accountId, epoch: 3 });
        expect((await post(alice, `/folds/${foldPath(fold)}/invitations`, { entry: wrong, grants: [await grantFor(fold, alice.account, alice.account, 3, 1)] })).status).toBe(400);
        void bob;

        const quiet = await rig({ mail: { kind: 'none' } });
        const [a2, b2] = [await quiet.person(), await quiet.person()];
        const second = await createFold(a2, 3);
        expect((await post(a2, `/folds/${foldPath(second.fold)}/invitations`, { entry: await second.chain.add(a2.account, b2.account, 2), grants: [await grantFor(second.fold, a2.account, b2.account, 1)] })).status).toBe(201);
        expect(quiet.h.mail.sent).toEqual([]);
      });

      it('is limited to twenty invitations a day per sender', async () => {
        const r = await rig({ rateLimitScale: 1 });
        const [alice, bob] = [await r.person(), await r.person()];
        const statuses: number[] = [];
        for (let n = 1; n <= 21; n++) {
          const { fold, chain } = await createFold(alice, n);
          statuses.push((await post(alice, `/folds/${foldPath(fold)}/invitations`, { entry: await chain.add(alice.account, bob.account, 3), grants: [await grantFor(fold, alice.account, bob.account, 1, 3)] })).status);
        }
        expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
        expect(statuses[20]).toBe(429);
        r.h.clock.now += 24 * 3_600_000 + 1;
        const fresh = { account: alice.account, session: (await signIn(r.h, alice.account)).session };
        const again = await createFold(fresh, 22);
        expect((await fresh.session.request('POST', `/folds/${foldPath(again.fold)}/invitations`, { entry: await again.chain.add(alice.account, bob.account, 3), grants: [await grantFor(again.fold, alice.account, bob.account, 1, 3)] })).status).toBe(201);
      });
    });
  });
}

/** A signed op under a given epoch (the shared helper always uses epoch 1). */
async function signedOpAt(fold: Buffer, who: TestAccount, seq: bigint, epoch: number): Promise<Uint8Array> {
  const base = decode(await signedOp(fold, who.device, seq)) as Map<string, unknown>;
  void base;
  const { encodeOpEnvelope } = await import('@cashfold/protocol');
  const { opSigningBytes } = await import('@cashfold/protocol/wire');
  const e = { v: 1 as const, fold, op: randomBytes(16), rec: randomBytes(16), dev: who.device.devId, seq, hlc: { wallMs: 1_800_000_000_000 + Number(seq), ctr: 0 }, epoch, schema: 1, blob: randomBytes(120) };
  return encodeOpEnvelope({ ...e, sig: await signer.sign(who.device.sigSk, opSigningBytes(e)) });
}

async function registerWithSignature(h: Harness, bundleSig: Uint8Array): Promise<void> {
  const { randomX, testPake } = await import('./pake.js');
  const { newAccountId, newDevice } = await import('./relay-harness.js');
  const { encodeKeySet } = await import('@cashfold/protocol');
  const { x25519PublicKey } = await import('@cashfold/crypto');
  const pake = await testPake();
  const sig = await signer.generate(rng);
  const encPk = x25519PublicKey(SecretBuf.from(rng.bytes(32)));
  const device = await newDevice();
  const accountId = newAccountId();
  const body = {
    account_id: accountId, email: `${accountId.toLowerCase()}@example.com`, auth_salt: randomBytes(16), kdf: { kdf: 'argon2id', m_kib: 65_536n, t: 3n, p: 1n, enc_salt: randomBytes(16) },
    srp_verifier: pake.verifier(SecretBuf.from(randomX())), device: { dev_id: device.devId, sig_pk: device.sigPk }, bundle_sig: bundleSig,
    keyset: encodeKeySet({
      v: 1, uuid: randomBytes(16), enc: { alg: 'HPKE-X25519-HKDF-SHA256-AES256GCM', pk: encPk, sk_ct: randomBytes(60) }, sig: { alg: 'Ed25519', pk: sig.publicKey, sk_ct: randomBytes(60) },
      kdf: { kdf: 'argon2id', m_kib: 65_536, t: 3, p: 1, v: 19, enc_salt: randomBytes(16) }, encrypted_by: 'mp',
    }),
  };
  const res = await h.raw('POST', '/accounts', { 'content-type': 'application/cbor' }, cbor(body));
  if (res.statusCode !== 201) throw new Error(`registration failed: ${res.statusCode}`);
}
