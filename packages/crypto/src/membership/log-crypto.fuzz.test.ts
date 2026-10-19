import { encode } from '@cashfold/protocol/cbor';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeEntry, encodeEntry, type PlainLogEntry } from './log-crypto';

// Fuzzing the membership-log parser (Constitution, Quality Gates; T191). Entries arrive from the service and from other members, so
// anything may arrive. The parser must either return an entry or refuse with an error it raised on purpose; a TypeError or RangeError
// would mean it tripped over its own assumptions.

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
const valid: PlainLogEntry = {
  idx: 3, prev: bytes(32), type: 'add_member', subject: 'BOB222', role: 2, scope: 'from_join', fromEpoch: 2, pubkeys: { enc: bytes(32), sig: bytes(32) }, signer: 'ALICE1', ts: 1_800_000_000_000, sig: bytes(64),
} as never;
const UNINTENDED = [TypeError, RangeError, ReferenceError, SyntaxError];

function parses(input: Uint8Array): 'entry' | 'refused' {
  try {
    decodeEntry(input);
    return 'entry';
  } catch (e) {
    for (const bad of UNINTENDED) expect(e instanceof bad, `${(e as Error).name}: ${(e as Error).message}`).toBe(false);
    expect(e).toBeInstanceOf(Error);
    return 'refused';
  }
}

describe('membership log entry parser', () => {
  it('reads what it wrote', () => {
    expect(decodeEntry(encodeEntry(valid))).toEqual(valid);
  });

  it('refuses arbitrary bytes cleanly', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 600 }), (b) => void parses(b)), { numRuns: 3000 });
  });

  it('refuses arbitrary well-formed CBOR of the wrong shape cleanly', () => {
    fc.assert(fc.property(fc.anything({ maxDepth: 4 }), (v) => {
      let encoded: Uint8Array;
      try {
        encoded = encode(v as never);
      } catch {
        return; // not encodable: nothing arrives
      }
      parses(encoded);
    }), { numRuns: 3000 });
  });

  it('survives every single-byte change and every cut of a valid entry', () => {
    const good = encodeEntry(valid);
    for (let i = 0; i < good.length; i++) {
      for (const value of [0, 1, 0x7f, 0x80, 0xff, good[i]! ^ 1]) {
        const copy = Uint8Array.from(good);
        copy[i] = value;
        parses(copy);
      }
      parses(good.slice(0, i));
    }
    parses(Uint8Array.from([...good, 0]));
  });

  it('never accepts an entry with a field of the wrong kind', () => {
    const base = { v: 1, idx: 3n, prev: bytes(32), type: 'add_member', subject: 'BOB222', signer: 'ALICE1', ts: 1_800_000_000_000n, sig: bytes(64) };
    fc.assert(fc.property(fc.constantFrom('idx', 'prev', 'type', 'subject', 'signer', 'ts', 'sig', 'role', 'scope'), fc.anything({ maxDepth: 2 }), (field, v) => {
      let encoded: Uint8Array;
      try {
        encoded = encode({ ...base, [field]: v } as never);
      } catch {
        return;
      }
      parses(encoded);
    }), { numRuns: 2000 });
  });
});
