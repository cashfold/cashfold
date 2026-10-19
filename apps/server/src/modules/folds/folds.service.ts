import { createPublicKey, verify } from 'node:crypto';
import { decodeOpEnvelope } from '@cashfold/protocol';
import { opSigningBytes } from '@cashfold/protocol/wire';
import { EventEmitter } from 'node:events';
import type { Bytes, OpRow, PushOutcome, Store } from '../../store/store.js';

export const MAX_OPS_PER_PUSH = 256;
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;
export const MAX_OP_BLOB = 256 * 1024;
export const PULL_LIMIT = 500;

export type PushError = 'bad_signature' | 'unauthorised' | 'seq_gap' | 'seq_conflict' | 'too_large' | 'unknown_epoch' | 'duplicate';
export interface PushResult {
  readonly op: Bytes;
  readonly serverSeq?: bigint;
  readonly error?: PushError;
}

/** SPKI prefix for a raw Ed25519 public key, so Node's verifier can take the 32 bytes the devices register. */
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return verify(null, message, createPublicKey({ key: Buffer.concat([SPKI, publicKey]), format: 'der', type: 'spki' }), signature);
  } catch {
    return false;
  }
}

/** Announces that a Fold has new ops, so open streams can tell their clients to pull. */
export const foldEvents = (): EventEmitter => new EventEmitter();

export function createFoldsService(deps: { store: Store; events: EventEmitter }) {
  const { store, events } = deps;
  const hex = (b: Bytes): string => Buffer.from(b).toString('hex');

  return {
    async create(foldId: Bytes, owner: string, atMs: number): Promise<'ok' | 'exists'> {
      return store.folds.create(foldId, owner, atMs);
    },

    /**
     * Stores ops from one device. The relay checks what it can without opening anything: the envelope parses, belongs to this
     * Fold and was authored by the pushing device, the Ed25519 signature verifies against the device's registered key, and
     * the device's sequence is gapless. Content, epochs and merge rules are the clients' business (FR-080).
     */
    async push(foldId: Bytes, accountId: string, deviceId: Bytes, deviceKey: Bytes | undefined, rawOps: readonly Uint8Array[]): Promise<{ status: 200 | 403 | 413; results: PushResult[] }> {
      const role = await store.folds.roleOf(foldId, accountId);
      if (role === undefined || role > 2 || deviceKey === undefined) return { status: 403, results: [] };
      if (rawOps.length > MAX_OPS_PER_PUSH || rawOps.reduce((n, o) => n + o.length, 0) > MAX_PUSH_BYTES) return { status: 413, results: [] };

      const verdicts: Array<{ error: PushError } | { row: OpRow; op: Bytes }> = [];
      for (const raw of rawOps) {
        let e;
        try {
          e = decodeOpEnvelope(raw);
        } catch {
          verdicts.push({ error: 'bad_signature' });
          continue;
        }
        if (e.blob.length > MAX_OP_BLOB) verdicts.push({ error: 'too_large' });
        else if (hex(e.fold) !== hex(foldId) || hex(e.dev) !== hex(deviceId)) verdicts.push({ error: 'unauthorised' });
        else if (!verifyEd25519(deviceKey, opSigningBytes(e), e.sig)) verdicts.push({ error: 'bad_signature' });
        else {
          verdicts.push({ op: e.op, row: { opId: e.op, recId: e.rec, devId: e.dev, devSeq: e.seq, hlcWall: e.hlc.wallMs, hlcCtr: e.hlc.ctr, epoch: e.epoch, schemaVer: e.schema, blob: e.blob, sig: e.sig } });
        }
      }

      const accepted = verdicts.flatMap((v) => ('row' in v ? [v.row] : []));
      const outcomes: readonly PushOutcome[] = accepted.length === 0 ? [] : await store.ops.push(foldId, accepted);
      let next = 0;
      let stored = false;
      const results: PushResult[] = verdicts.map((v, i) => {
        if ('error' in v) return { op: opIdOf(rawOps[i]!), error: v.error };
        const o = outcomes[next++]!;
        if (o.status === 'stored') {
          stored = true;
          return { op: o.op, serverSeq: o.serverSeq };
        }
        if (o.status === 'duplicate') return { op: o.op, serverSeq: o.serverSeq, error: 'duplicate' };
        return { op: o.op, error: o.status };
      });
      if (stored) events.emit('changed', hex(foldId));
      return { status: 200, results };
    },

    async pull(foldId: Bytes, accountId: string, after: bigint, limit: number) {
      if ((await store.folds.roleOf(foldId, accountId)) === undefined) return undefined;
      return store.ops.pull(foldId, after, Math.min(Math.max(limit, 1), PULL_LIMIT));
    },
  };
}

function opIdOf(raw: Uint8Array): Bytes {
  try {
    return decodeOpEnvelope(raw).op;
  } catch {
    return new Uint8Array(16);
  }
}

export type FoldsService = ReturnType<typeof createFoldsService>;
