import fc from 'fast-check';
import { decodeEntry, encodeEntry, type PlainLogEntry } from '@cashfold/crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { LogBuilder, logCrypto, person, type Person } from '../../testing/index';
import { replayLog } from './membership-log';

// Fuzzing the membership-log verifier (T191). Whatever order, subset, repetition or corruption of a real log reaches it, replay must
// answer with a result, never throw, and must never accept a log that was changed so that it is no longer the one the members signed.

let alice: Person, bob: Person, carol: Person;
let entries: PlainLogEntry[];

beforeAll(async () => {
  [alice, bob, carol] = [await person('ALICE1', 0xa1), await person('BOB222', 0xb1), await person('CAROL3', 0xc1)];
  const log = new LogBuilder();
  await log.genesis(alice);
  await log.append(alice, { type: 'add_member', subject: bob.account, role: 2, scope: 'full', fromEpoch: 1, pubkeys: { enc: bob.enc.publicKey, sig: bob.sig.publicKey } });
  await log.append(alice, { type: 'add_member', subject: carol.account, role: 3, scope: 'from_join', fromEpoch: 1, pubkeys: { enc: carol.enc.publicKey, sig: carol.sig.publicKey } });
  await log.append(alice, { type: 'change_role', subject: bob.account, role: 3 });
  await log.append(alice, { type: 'remove_member', subject: carol.account });
  entries = [...log.entries];
});

const safe = async (candidate: readonly PlainLogEntry[]) => {
  const r = await replayLog(candidate as never, logCrypto);
  expect(typeof r.ok).toBe('boolean');
  return r;
};

describe('membership log replay', () => {
  it('accepts the real log', async () => {
    expect((await safe(entries)).ok).toBe(true);
  });

  it('answers any selection, order and repetition of the real entries without throwing, and accepts only the genuine prefix', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: entries.length - 1 }), { maxLength: 12 }), async (picks) => {
        const r = await safe(picks.map((i) => entries[i]!));
        const genuine = picks.length > 0 && picks.every((p, i) => p === i);
        if (r.ok) expect(genuine).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('refuses a log in which any byte of any entry was changed', async () => {
    const encoded = entries.map((e) => encodeEntry(e));
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: entries.length - 1 }), fc.nat(), fc.integer({ min: 1, max: 255 }), async (which, at, flip) => {
        const copy = Uint8Array.from(encoded[which]!);
        copy[at % copy.length] = copy[at % copy.length]! ^ flip;
        let changed: PlainLogEntry;
        try {
          changed = decodeEntry(copy);
        } catch {
          return; // not even an entry: refused earlier
        }
        const log = encoded.map((e, i) => (i === which ? changed : decodeEntry(e)));
        const r = await safe(log);
        // A changed entry may by luck decode to an equal one only if the changed bit is outside everything signed or chained.
        if (r.ok) expect(encodeEntry(log[which]!)).toEqual(encoded[which]);
      }),
      { numRuns: 600 },
    );
  });

  it('refuses entries with fields replaced by arbitrary values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: entries.length - 1 }),
        fc.constantFrom('idx', 'subject', 'signer', 'ts', 'role', 'type', 'epoch', 'fromEpoch', 'scope', 'server'),
        fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.constant(undefined), fc.bigInt(), fc.uint8Array({ maxLength: 40 })),
        async (which, field, value) => {
          const forged = { ...entries[which], [field]: value } as PlainLogEntry;
          const r = await safe(entries.map((e, i) => (i === which ? forged : e)));
          if (r.ok) expect(forged[field as keyof PlainLogEntry]).toEqual(entries[which]![field as keyof PlainLogEntry]);
        },
      ),
      { numRuns: 800 },
    );
  });
});
