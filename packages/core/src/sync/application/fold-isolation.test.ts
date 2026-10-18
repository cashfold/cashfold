import { createAesGcm, createHkdf, createRecordCrypto, SecretBuf } from '@cashfold/crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id.js';
import { createReplica, createWorld, id } from '../../testing/index.js';
import type { FieldValue } from '../domain/merge.js';

// FR-021: Folds are fully isolated. Different keys per Fold, and every read path takes the Fold id.

const FOLD_A = id(0xa1);
const FOLD_B = id(0xb1);
const osRng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const records = createRecordCrypto({ aead: createAesGcm(), hkdf: createHkdf(), rng: osRng });
const idBytes = (n: number) => new Uint8Array(16).fill(n);

describe('encryption: a record sealed for one Fold cannot be opened with any key of another', () => {
  it('property: foreign fold keys never open the blob, whatever the identifiers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 0, max: 5 }),
        fc.uint8Array({ maxLength: 64 }),
        async (keyA, keyB, table, epoch, payload) => {
          fc.pre(Buffer.compare(Buffer.from(keyA), Buffer.from(keyB)) !== 0);
          const ctx = { foldId: idBytes(1), recordId: idBytes(7), table, epoch, schema: 1 };
          const blob = await records.seal(SecretBuf.from(keyA), ctx, payload);
          await expect(records.open(SecretBuf.from(keyB), ctx, blob)).rejects.toThrow();
          // Even the right key does not open it as a record of the other Fold (AAD binds the Fold id).
          await expect(records.open(SecretBuf.from(keyA), { ...ctx, foldId: idBytes(2) }, blob)).rejects.toThrow();
          expect(Array.from(await records.open(SecretBuf.from(keyA), ctx, blob))).toEqual(Array.from(payload));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('a device that holds only Fold A cannot read Fold B ops, and does not store them', async () => {
    const world = await createWorld();
    world.addFold(FOLD_A);
    world.addFold(FOLD_B);
    const writer = await createReplica(world, { device: id(0xa) });
    await writer.writePath.submit({ fold: FOLD_B, rec: id(1), table: 6, fields: new Map([[1, 'secret in B']]), sets: new Map() });
    const [opOfB] = await writer.oplog.list(FOLD_B);

    world.dropFold(FOLD_B); // from here on no device in this world holds a key for B
    const reader = await createReplica(world, { device: id(0xb) });
    const outcome = await reader.writePath.applyRemote(opOfB!.sealed);
    expect(outcome).toMatchObject({ ok: true, value: { kind: 'ignored', reason: 'unknown_fold' } });
    expect((await reader.projections.listRecords(FOLD_B)).size).toBe(0);
    expect(await reader.oplog.list(FOLD_B)).toHaveLength(0);
  });
});

describe('storage: every read path is scoped by Fold id', () => {
  it('property: no Fold ever sees a record written through the other', async () => {
    const edit = fc.record({
      fold: fc.constantFrom(FOLD_A, FOLD_B),
      rec: fc.constantFrom(id(1), id(2), id(3)),
      value: fc.string({ maxLength: 4 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(edit, { minLength: 1, maxLength: 10 }), async (edits) => {
        const world = await createWorld();
        world.addFold(FOLD_A);
        world.addFold(FOLD_B);
        const r = await createReplica(world, { device: id(0xa) });
        const opsOf = new Map<Id, Set<Id>>([[FOLD_A, new Set()], [FOLD_B, new Set()]]);
        for (const e of edits) {
          const res = await r.writePath.submit({ fold: e.fold, rec: e.rec, table: 6, fields: new Map<number, FieldValue>([[1, e.value]]), sets: new Map() });
          if (!res.ok) throw new Error('submit failed');
          opsOf.get(e.fold)!.add(res.value.op.id);
        }
        for (const fold of [FOLD_A, FOLD_B]) {
          for (const state of (await r.projections.listRecords(fold)).values()) {
            for (const entry of state.fields.values()) expect(opsOf.get(fold)!.has(entry.opId)).toBe(true);
          }
          expect((await r.oplog.list(fold)).every((s) => s.sealed.fold === fold)).toBe(true);
        }
        // The same record id in both Folds is two different records.
        const a = await r.projections.getRecord(FOLD_A, id(1));
        const b = await r.projections.getRecord(FOLD_B, id(1));
        if (a && b) expect(a).not.toBe(b);
      }),
      { numRuns: 20 },
    );
  });

  it('rebuilding or clearing one Fold leaves the other untouched', async () => {
    const world = await createWorld();
    world.addFold(FOLD_A);
    world.addFold(FOLD_B);
    const r = await createReplica(world, { device: id(0xa) });
    await r.writePath.submit({ fold: FOLD_A, rec: id(1), table: 6, fields: new Map([[1, 'a']]), sets: new Map() });
    await r.writePath.submit({ fold: FOLD_B, rec: id(1), table: 6, fields: new Map([[1, 'b']]), sets: new Map() });
    const bBefore = await r.projections.listRecords(FOLD_B);
    await r.projections.clear(FOLD_A);
    expect((await r.projections.listRecords(FOLD_A)).size).toBe(0);
    expect(await r.projections.listRecords(FOLD_B)).toEqual(bBefore);
    await r.writePath.rebuild(FOLD_A);
    expect((await r.projections.getRecord(FOLD_A, id(1)))?.fields.get(1)?.value).toBe('a');
    expect(await r.projections.listRecords(FOLD_B)).toEqual(bBefore);
  });
});
