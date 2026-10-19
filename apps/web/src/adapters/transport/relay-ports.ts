import { foldRef, idFromBytes, idToBytes, type Id, type PullResult, type PushOutcome, type SealedOp, type SnapshotTransportPort, type TransportPort } from '@cashfold/core';
import { envelopeToSealed, sealedToEnvelope } from '@cashfold/crypto';
import { decodeOpEnvelopeWire as decodeOpEnvelope, encodeOpEnvelopeWire as encodeOpEnvelope } from '@cashfold/protocol/wire';
import type { RelayErrorKind, RelayLink } from '@cashfold/core';

// Core's transport ports over a signed-in relay session. Ops travel as their CBOR envelopes exactly as signed; the service
// numbers them and hands them back untouched, and the client checks everything (signature, tag, sequence) itself.

/** A failure the sync client can classify: `kind` is 'offline' for a network problem, anything else for the rest. */
export class RelayFailure extends Error {
  constructor(readonly kind: RelayErrorKind, readonly status?: number) {
    super(`relay: ${kind}`);
    this.name = 'RelayFailure';
  }
}

const asMap = (v: unknown): ReadonlyMap<string, unknown> => (v instanceof Map ? (v as ReadonlyMap<string, unknown>) : new Map());
const need = async (reply: ReturnType<RelayLink['request']>): Promise<unknown> => {
  const r = await reply;
  if (!r.ok) throw new RelayFailure(r.kind, r.status);
  return r.body;
};

export function createRelayTransport(link: RelayLink): TransportPort {
  return {
    async push(fold, ops) {
      const body = await need(link.request('POST', `/folds/${foldRef(fold)}/ops`, ops.map((o) => encodeOpEnvelope(sealedToEnvelope(o as never)))));
      if (!Array.isArray(body)) throw new RelayFailure('protocol');
      const out: PushOutcome[] = [];
      for (const row of body as unknown[]) {
        const m = asMap(row);
        const op = m.get('op');
        if (!(op instanceof Uint8Array) || op.length !== 16) continue;
        const seq = m.get('server_seq');
        const error = m.get('error');
        out.push({
          op: idFromBytes(op),
          ...(typeof seq === 'bigint' && { serverSeq: seq }),
          ...(typeof error === 'string' && { error: error as NonNullable<PushOutcome['error']> }),
        });
      }
      return out;
    },

    async pull(fold, after, limit): Promise<PullResult> {
      const body = asMap(await need(link.request('GET', `/folds/${foldRef(fold)}/ops?after=${after}&limit=${limit}`)));
      const rows = body.get('ops');
      const head = body.get('head');
      if (!Array.isArray(rows) || typeof head !== 'bigint') throw new RelayFailure('protocol');
      const ops: { serverSeq: bigint; sealed: SealedOp }[] = [];
      for (const row of rows as unknown[]) {
        const m = asMap(row);
        const [seq, bytes] = [m.get('server_seq'), m.get('op')];
        if (typeof seq !== 'bigint' || !(bytes instanceof Uint8Array)) continue;
        try {
          ops.push({ serverSeq: seq, sealed: envelopeToSealed(decodeOpEnvelope(bytes)) as unknown as SealedOp });
        } catch {
          // An envelope that does not parse is dropped here; the gap it leaves is what the sync client reports.
        }
      }
      return { ops, head, more: body.get('more') === true };
    },
  };
}

export function createRelaySnapshotTransport(link: RelayLink): SnapshotTransportPort {
  return {
    async put(fold, snapshot) {
      await need(link.request('PUT', `/folds/${foldRef(fold)}/snapshot`, { fold: idToBytes(fold), at_seq: snapshot.atSeq, epoch: BigInt(snapshot.epoch), blob: snapshot.blob, sig: snapshot.sig }));
    },
    async get(fold) {
      const r = await link.request('GET', `/folds/${foldRef(fold)}/snapshot`);
      if (!r.ok) {
        if (r.kind === 'not_found') return undefined;
        throw new RelayFailure(r.kind, r.status);
      }
      const m = asMap(r.body);
      const [atSeq, blob, sig] = [m.get('at_seq'), m.get('blob'), m.get('sig')];
      if (typeof atSeq !== 'bigint' || !(blob instanceof Uint8Array) || !(sig instanceof Uint8Array)) throw new RelayFailure('protocol');
      const epoch = m.get('epoch');
      return { atSeq, blob, sig, epoch: typeof epoch === 'bigint' ? Number(epoch) : 1 };
    },
    async ack(fold, seq) {
      await need(link.request('POST', `/folds/${foldRef(fold)}/ack`, { seq }));
    },
  };
}

export type { Id };
