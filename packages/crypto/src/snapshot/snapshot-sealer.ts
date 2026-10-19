import { encode } from '@cashfold/protocol/cbor';
import { AeadError, type Aead, type Hkdf, type Rng, type Signer } from '../ports/index';
import { uuidBytes, uuidText, SealError, type OpKeys } from '../op/op-sealer';
import { createRecordCrypto } from '../record/record-crypto';

// A snapshot is the merged state of a Fold at one point of the relay's log, sealed so that the relay can store it but not read
// or alter it (FR-082). Same order of checks as ops: signature first, then the AEAD tag, then the caller parses.
//
//   sealed blob = signer device id (16) || record-crypto blob of the payload
//   record context: record id = 8 zero bytes || at_seq (u64 BE), table 0, the Fold's epoch, schema 1
//   signature   = Ed25519 over CBOR ["cashfold.snap.v1", fold, epoch, at_seq, blob]

const LABEL = 'cashfold.snap.v1';
const SCHEMA = 1;
const DEV_BYTES = 16;

export interface SnapshotContext {
  readonly fold: string;
  readonly epoch: number;
  readonly atSeq: bigint;
}

export interface SealedSnapshot {
  readonly blob: Uint8Array;
  readonly sig: Uint8Array;
}

export interface SnapshotSealer {
  /** `dev` is the signing device's id, which the opener uses to find the key that verifies the signature. */
  seal(ctx: SnapshotContext & { dev: string }, payload: Uint8Array): Promise<SealedSnapshot>;
  open(ctx: SnapshotContext, sealed: SealedSnapshot): Promise<{ payload: Uint8Array; dev: string }>;
}

const seqBytes = (atSeq: bigint): Uint8Array => {
  if (atSeq < 0n || atSeq > 0xffff_ffff_ffff_ffffn) throw new RangeError('at_seq out of range');
  const out = new Uint8Array(16);
  new DataView(out.buffer).setBigUint64(8, atSeq);
  return out;
};

const signedBytes = (ctx: SnapshotContext, blob: Uint8Array): Uint8Array => encode([LABEL, uuidBytes(ctx.fold), ctx.epoch, ctx.atSeq, blob] as never);

export function createSnapshotSealer({ aead, hkdf, signer, rng, keys }: { aead: Aead; hkdf: Hkdf; signer: Signer; rng: Rng; keys: OpKeys }): SnapshotSealer {
  const records = createRecordCrypto({ aead, hkdf, rng });
  const recordCtx = (ctx: SnapshotContext) => ({ foldId: uuidBytes(ctx.fold), recordId: seqBytes(ctx.atSeq), table: 0, epoch: ctx.epoch, schema: SCHEMA });

  return {
    async seal(ctx, payload) {
      const foldKey = await keys.foldKey(ctx.fold, ctx.epoch);
      if (foldKey === undefined) throw new SealError('unknown_key');
      const inner = await records.seal(foldKey, recordCtx(ctx), payload);
      const blob = new Uint8Array(DEV_BYTES + inner.length);
      blob.set(uuidBytes(ctx.dev));
      blob.set(inner, DEV_BYTES);
      return { blob, sig: await signer.sign(keys.deviceSigningKey(), signedBytes(ctx, blob)) };
    },

    async open(ctx, sealed) {
      if (sealed.blob.length <= DEV_BYTES) throw new SealError('malformed');
      const dev = uuidText(sealed.blob.slice(0, DEV_BYTES));
      const publicKey = await keys.signerPublicKey(ctx.fold, dev);
      if (publicKey === undefined) throw new SealError('unknown_signer');
      if (!(await signer.verify(publicKey, signedBytes(ctx, sealed.blob), sealed.sig))) throw new SealError('bad_signature');
      const foldKey = await keys.foldKey(ctx.fold, ctx.epoch);
      if (foldKey === undefined) throw new SealError('unknown_key');
      try {
        return { payload: await records.open(foldKey, recordCtx(ctx), sealed.blob.slice(DEV_BYTES)), dev };
      } catch (e) {
        if (e instanceof AeadError) throw new SealError('decrypt_failed');
        throw e;
      }
    },
  };
}
