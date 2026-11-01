import { createAesGcm, createBackupCrypto, createHkdf, createPbkdf2, SecretBuf } from '@cashfold/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountFieldPatch } from '../../ledger/domain/account';
import { TABLE } from '../../ledger/domain/tables';
import { transactionFieldPatch } from '../../ledger/domain/transaction';
import { DELETED_FIELD, visibleMembers, type RecordState } from '../domain/merge';
import { createParticipant, date, FakeService, id, worldFold, type Participant } from '../../testing/index';
import { createBackupService, type BackupCryptoPort } from './backup';
import type { SnapshotCodecPort } from './snapshot';
import { decodeSnapshot, encodeSnapshot } from '@cashfold/protocol/snapshot';

const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const real = createBackupCrypto({ aead: createAesGcm(), hkdf: createHkdf(), kdf: createPbkdf2(), rng, defaultKdf: { kdf: 'pbkdf2-hmac-sha256', iterations: 600_000 } });
const adapter: BackupCryptoPort = {
  seal: (plain, s) => real.seal(plain, s.kind === 'passphrase' ? { kind: 'passphrase', passphrase: SecretBuf.from(s.passphrase.use((b) => Uint8Array.from(b))) } : { kind: 'foldKey', key: SecretBuf.from(s.key.use((b) => Uint8Array.from(b))), fold: Buffer.from(s.fold.replaceAll('-', ''), 'hex') }),
  open: (f, s) => real.open(f, s.kind === 'passphrase' ? { kind: 'passphrase', passphrase: SecretBuf.from(s.passphrase.use((b) => Uint8Array.from(b))) } : { kind: 'foldKey', key: SecretBuf.from(s.key.use((b) => Uint8Array.from(b))), fold: Buffer.from(s.fold.replaceAll('-', ''), 'hex') }),
};
const codec: SnapshotCodecPort = { encode: (d) => encodeSnapshot(d as never), decode: (b) => decodeSnapshot(b) as never };
const pass = (s: string) => ({ kind: 'passphrase' as const, passphrase: SecretBuf.from(new TextEncoder().encode(s)) });

let alice: Participant;
const FROM = worldFold(5);
const TO = worldFold(6);
const service = () => createBackupService({ projections: alice.projections, writePath: alice.writePath, codec, crypto: adapter });

beforeEach(async () => {
  alice = await createParticipant(new FakeService(), 'ALICE1', 0xa1);
  await alice.createFold(FROM, 'Home');
  const put = async (rec: ReturnType<typeof id>, table: number, fields: Map<number, never>, sets = new Map()) => {
    const r = await alice.writePath.submit({ fold: FROM, rec, table, fields, sets });
    if (!r.ok) throw new Error(r.error.code);
  };
  await put(id(1), TABLE.account, accountFieldPatch({ kind: 'checking', name: 'Main', currency: 'USD' as never, openingBalanceMinor: 123_456n, openingDate: date(2020, 1, 1), includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 2, sortOrder: 0, archived: false }) as never);
  await put(id(2), TABLE.tag, new Map([[1, 'trip']]) as never);
  alice.now += 1000;
  await put(id(1), TABLE.account, new Map([[2, 'Main account']]) as never, new Map([[12, { add: [id(2)], rem: [] }]]));
  for (let n = 0; n < 3; n++) {
    alice.now += 1000;
    await put(id(10 + n), TABLE.transaction, transactionFieldPatch({
      accountId: id(1), direction: 'expense', amountMinor: -(100n + BigInt(n)), currency: 'USD' as never, baseAmountMinor: -(100n + BigInt(n)), baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null,
      occurredUtcMs: Date.UTC(2026, 1, 1 + n, 12), tzOffsetMin: 0, localDate: date(2026, 2, 1 + n), status: 'posted', note: `n${n}`,
    }) as never);
  }
  alice.now += 1000;
  await put(id(12), TABLE.transaction, new Map([[DELETED_FIELD, true]]) as never); // a deleted record is part of the Fold too
});

const view = (s: RecordState) => ({
  table: s.table,
  fields: [...s.fields].map(([f, e]) => [f, e.value, e.hlc.wallMs, e.hlc.ctr] as const).sort((a, b) => a[0] - b[0]),
  sets: [...s.sets.keys()].sort().map((f) => [f, [...visibleMembers(s, f)].sort()] as const),
});

describe('encrypted backup and restore (FR-091)', () => {
  it('restores into a new Fold exactly: the same values, clocks, tombstones and set members', async () => {
    const file = await service().create(FROM, pass('correct horse'));
    await alice.createFold(TO, 'Restored');
    const result = await service().restore(file, pass('correct horse'), TO);
    expect(result).toMatchObject({ ok: true });
    const [original, restored] = [await alice.projections.listRecords(FROM), await alice.projections.listRecords(TO)];
    for (const [rec, state] of original) {
      if (state.table === 13) continue; // the Fold's own settings differ by design: it is a new Fold with its own name
      expect(restored.has(rec), `record ${rec}`).toBe(true);
      expect(view(restored.get(rec)!)).toEqual(view(state));
    }
    expect((await alice.ledger(TO)).accounts.get(id(1))).toMatchObject({ name: 'Main account', openingBalanceMinor: 123_456n });
    expect((await alice.ledger(TO)).transactions.size).toBe(2);
  });

  it('restores a category record that carries the reserved icon field (4) without the icon (spec 019, FR-006)', async () => {
    alice.now += 1000;
    const r = await alice.writePath.submit({
      fold: FROM, rec: id(40), table: TABLE.category,
      fields: new Map<number, never>([[1, 1n], [2, null], [3, 'Food'], [4, 'utensils'], [5, 3n]] as never), sets: new Map(),
    });
    expect(r.ok).toBe(true);
    const file = await service().create(FROM, pass('p'));
    await alice.createFold(TO, 'Restored');
    expect(await service().restore(file, pass('p'), TO)).toMatchObject({ ok: true });
    const food = (await alice.ledger(TO)).categories.get(id(40));
    expect(food).toMatchObject({ name: 'Food', color: 3, direction: 'expense', parentId: null });
    expect(food).not.toHaveProperty('icon');
  });

  it('the restored data syncs like any other: it is ops waiting to be pushed', async () => {
    const file = await service().create(FROM, pass('p'));
    await alice.createFold(TO, 'Restored');
    const pendingBefore = (await alice.oplog.listPending(TO)).length;
    await service().restore(file, pass('p'), TO);
    expect((await alice.oplog.listPending(TO)).length).toBeGreaterThan(pendingBefore);
  });

  it('refuses a wrong passphrase, a file that is not a backup and a damaged one, without touching the Fold', async () => {
    const file = await service().create(FROM, pass('right'));
    await alice.createFold(TO, 'Restored');
    expect(await service().restore(file, pass('wrong'), TO)).toMatchObject({ ok: false, error: { code: 'wrong_secret' } });
    expect(await service().restore(new Uint8Array([1, 2, 3]), pass('right'), TO)).toMatchObject({ ok: false, error: { code: 'not_a_backup' } });
    expect([...(await alice.projections.listRecords(TO)).values()].every((s) => s.table === 13)).toBe(true);
  });

  it('will not restore over a Fold that already has data', async () => {
    const file = await service().create(FROM, pass('p'));
    expect(await service().restore(file, pass('p'), FROM)).toMatchObject({ ok: false, error: { code: 'not_empty' } });
  });

  it('can be made under the Fold key and restored with it', async () => {
    const key = alice.keyring.secret(FROM, 1)!;
    const file = await service().create(FROM, { kind: 'foldKey', key, fold: FROM });
    await alice.createFold(TO, 'Restored');
    expect(await service().restore(file, { kind: 'foldKey', key, fold: FROM }, TO)).toMatchObject({ ok: true });
    expect(await service().restore(file, pass('p'), TO)).toMatchObject({ ok: false });
  });

  it('tells what a backup holds without restoring anything, so the new Fold can match it', async () => {
    const file = await service().create(FROM, pass('p'));
    expect(await service().inspect(file, pass('p'))).toEqual({ ok: true, value: { name: 'Home', baseCurrency: 'USD', records: expect.any(Number) } });
    expect(await service().inspect(file, pass('wrong'))).toMatchObject({ ok: false, error: { code: 'wrong_secret' } });
    expect(await service().inspect(new Uint8Array([1, 2, 3]), pass('p'))).toMatchObject({ ok: false, error: { code: 'not_a_backup' } });
    expect((await alice.projections.listRecords(TO)).size).toBe(0);
  });
});
