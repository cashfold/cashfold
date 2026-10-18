import type { Id } from '../shared-kernel/id.js';
import type { PullResult, SealedOp, TransportPort } from '../sync/ports/index.js';
import type { Rng } from './rng.js';

export type PulledOp = PullResult['ops'][number];

/** What a malicious relay can do to the ops it serves. It holds no keys, so it can only rearrange or corrupt. */
export type Attack =
  | 'swap_blobs' // exchange the ciphertext of two ops, keeping their envelopes
  | 'flip_blob' // flip one ciphertext bit
  | 'forge_signature' // replace a signature with random bytes
  | 'rewrite_seq' // renumber an op's per-device sequence
  | 'wrong_fold' // present an op as belonging to another Fold
  | 'drop' // silently omit an op
  | 'replay' // serve an earlier op again later
  | 'reorder'; // serve ops in a different order

/** Attacks that corrupt content; every op they touch must be rejected. The others must leave state intact. */
export const TAMPERING: readonly Attack[] = ['swap_blobs', 'flip_blob', 'forge_signature', 'rewrite_seq', 'wrong_fold'];

const withSealed = (op: PulledOp, patch: Partial<SealedOp>): PulledOp => ({ serverSeq: op.serverSeq, sealed: { ...op.sealed, ...patch } });

/** Returns the ops as a hostile relay would serve them, plus the op ids that were tampered with. */
export function attack(ops: readonly PulledOp[], kind: Attack, rng: Rng, otherFold: Id): { served: PulledOp[]; touched: Id[] } {
  const out = [...ops];
  if (out.length < 2) throw new RangeError('need at least two ops to attack');
  const i = rng.int(out.length);
  const j = (i + 1 + rng.int(out.length - 1)) % out.length;
  const a = out[i]!;
  const b = out[j]!;

  switch (kind) {
    case 'swap_blobs':
      out[i] = withSealed(a, { blob: b.sealed.blob });
      out[j] = withSealed(b, { blob: a.sealed.blob });
      return { served: out, touched: [a.sealed.op, b.sealed.op] };
    case 'flip_blob': {
      const blob = Uint8Array.from(a.sealed.blob);
      const at = rng.int(blob.length);
      blob[at] = blob[at]! ^ (1 << rng.int(8));
      out[i] = withSealed(a, { blob });
      return { served: out, touched: [a.sealed.op] };
    }
    case 'forge_signature':
      out[i] = withSealed(a, { sig: rng.bytes(64) });
      return { served: out, touched: [a.sealed.op] };
    case 'rewrite_seq':
      out[i] = withSealed(a, { seq: a.sealed.seq + 1n });
      return { served: out, touched: [a.sealed.op] };
    case 'wrong_fold':
      out[i] = withSealed(a, { fold: otherFold });
      return { served: out, touched: [a.sealed.op] };
    case 'drop':
      out.splice(i, 1);
      return { served: out, touched: [a.sealed.op] };
    case 'replay':
      out.push(a, a);
      return { served: out, touched: [] };
    case 'reorder':
      return { served: out.reverse(), touched: [] };
  }
}

/** Wraps an honest transport so that every pull is served through `kind`. */
export function hostileTransport(honest: TransportPort, kind: Attack, rng: Rng, otherFold: Id): TransportPort {
  return {
    push: (fold, ops) => honest.push(fold, ops),
    async pull(fold, after, limit) {
      const result = await honest.pull(fold, after, limit);
      if (result.ops.length < 2) return result;
      return { ...result, ops: attack(result.ops, kind, rng, otherFold).served };
    },
  };
}
