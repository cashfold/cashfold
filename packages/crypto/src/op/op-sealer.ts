import { decodeOpPayload, encodeOpPayload, opSigningBytes, type FieldValue, type OpPayload } from '@cashfold/protocol/wire';
import type { OpEnvelope } from '@cashfold/protocol';
import { AeadError, type Aead, type Hkdf, type Rng, type Signer } from '../ports/index';
import { createRecordCrypto } from '../record/record-crypto';
import type { SecretBuf } from '../secret-buf';

// Seals a domain operation into a signed, encrypted envelope and opens it again.
// Ids travel as canonical UUID text so core can use these types without importing this package.
// Order of checks on open (ARCH 9.3): signature first, then the AEAD tag, then payload parsing.

export type { FieldValue };

export interface SetDeltaText {
  readonly add: readonly string[];
  readonly rem: readonly (readonly [string, string])[];
}

/** An operation in the clear: what a device produced, or what was recovered from a sealed op. */
export interface SealableOp {
  readonly fold: string;
  readonly op: string;
  readonly rec: string;
  readonly dev: string;
  readonly seq: bigint;
  readonly hlc: { readonly wallMs: number; readonly ctr: number };
  readonly epoch: number;
  readonly schema: number;
  readonly table: number;
  readonly fields: ReadonlyMap<number, FieldValue>;
  readonly sets: ReadonlyMap<number, SetDeltaText>;
}

/** The sealed form stored in the op log and sent to the relay. */
export interface SealedOp {
  readonly fold: string;
  readonly op: string;
  readonly rec: string;
  readonly dev: string;
  readonly seq: bigint;
  readonly hlc: { readonly wallMs: number; readonly ctr: number };
  readonly epoch: number;
  readonly schema: number;
  readonly blob: Uint8Array;
  readonly sig: Uint8Array;
}

export interface OpKeys {
  foldKey(fold: string, epoch: number): Promise<SecretBuf | undefined>;
  deviceSigningKey(): SecretBuf;
  /** The Ed25519 public key of `dev` as recorded in the Fold's membership log. */
  signerPublicKey(fold: string, dev: string): Promise<Uint8Array | undefined>;
}

export type SealErrorKind = 'unknown_signer' | 'bad_signature' | 'unknown_key' | 'decrypt_failed' | 'malformed';

export class SealError extends Error {
  constructor(readonly kind: SealErrorKind) {
    super(kind);
    this.name = 'SealError';
  }
}

export interface OpSealer {
  seal(op: SealableOp): Promise<SealedOp>;
  open(sealed: SealedOp): Promise<SealableOp>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuidBytes(text: string): Uint8Array {
  if (!UUID.test(text)) throw new RangeError('identifier is not a canonical lowercase UUID');
  const hex = text.replaceAll('-', '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function uuidText(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sealedToEnvelope(s: SealedOp): OpEnvelope {
  return {
    v: 1, fold: uuidBytes(s.fold), op: uuidBytes(s.op), rec: uuidBytes(s.rec), dev: uuidBytes(s.dev), seq: s.seq,
    hlc: { wallMs: s.hlc.wallMs, ctr: s.hlc.ctr }, epoch: s.epoch, schema: s.schema, blob: s.blob, sig: s.sig,
  };
}

export function envelopeToSealed(e: OpEnvelope): SealedOp {
  return {
    fold: uuidText(e.fold), op: uuidText(e.op), rec: uuidText(e.rec), dev: uuidText(e.dev), seq: e.seq,
    hlc: { wallMs: e.hlc.wallMs, ctr: e.hlc.ctr }, epoch: e.epoch, schema: e.schema, blob: e.blob, sig: e.sig,
  };
}

function toPayload(op: SealableOp): OpPayload {
  const payload: { t: number; f?: Map<number, FieldValue>; fx?: Map<number, { add?: Uint8Array[]; rem?: [Uint8Array, Uint8Array][] }> } = { t: op.table };
  if (op.fields.size > 0) payload.f = new Map(op.fields);
  if (op.sets.size > 0) {
    payload.fx = new Map(
      [...op.sets].map(([field, delta]) => {
        const out: { add?: Uint8Array[]; rem?: [Uint8Array, Uint8Array][] } = {};
        if (delta.add.length > 0) out.add = delta.add.map(uuidBytes);
        if (delta.rem.length > 0) out.rem = delta.rem.map(([member, tag]) => [uuidBytes(member), uuidBytes(tag)]);
        return [field, out];
      }),
    );
  }
  return payload as OpPayload;
}

export function createOpSealer({ aead, hkdf, signer, rng, keys }: { aead: Aead; hkdf: Hkdf; signer: Signer; rng: Rng; keys: OpKeys }): OpSealer {
  const records = createRecordCrypto({ aead, hkdf, rng });

  return {
    async seal(op) {
      const foldKey = await keys.foldKey(op.fold, op.epoch);
      if (foldKey === undefined) throw new SealError('unknown_key');
      const blob = await records.seal(
        foldKey,
        { foldId: uuidBytes(op.fold), recordId: uuidBytes(op.rec), table: op.table, epoch: op.epoch, schema: op.schema },
        encodeOpPayload(toPayload(op)),
      );
      const unsigned: SealedOp = {
        fold: op.fold, op: op.op, rec: op.rec, dev: op.dev, seq: op.seq, hlc: { ...op.hlc }, epoch: op.epoch, schema: op.schema,
        blob, sig: new Uint8Array(64),
      };
      const sig = await signer.sign(keys.deviceSigningKey(), opSigningBytes(sealedToEnvelope(unsigned)));
      return { ...unsigned, sig };
    },

    async open(sealed) {
      const publicKey = await keys.signerPublicKey(sealed.fold, sealed.dev);
      if (publicKey === undefined) throw new SealError('unknown_signer');
      if (!(await signer.verify(publicKey, opSigningBytes(sealedToEnvelope(sealed)), sealed.sig))) throw new SealError('bad_signature');

      const foldKey = await keys.foldKey(sealed.fold, sealed.epoch);
      if (foldKey === undefined) throw new SealError('unknown_key');

      let table: number;
      let plaintext: Uint8Array;
      try {
        ({ table, payload: plaintext } = await records.openDiscoveringTable(
          foldKey,
          { foldId: uuidBytes(sealed.fold), recordId: uuidBytes(sealed.rec), epoch: sealed.epoch, schema: sealed.schema },
          sealed.blob,
        ));
      } catch (e) {
        if (e instanceof AeadError) throw new SealError('decrypt_failed');
        throw e;
      }

      let payload: OpPayload;
      try {
        payload = decodeOpPayload(plaintext);
      } catch {
        throw new SealError('malformed');
      }
      if (payload.t !== table) throw new SealError('malformed');

      const sets = new Map<number, SetDeltaText>();
      for (const [field, delta] of payload.fx ?? []) {
        sets.set(field, {
          add: (delta.add ?? []).map(uuidText),
          rem: (delta.rem ?? []).map(([member, tag]) => [uuidText(member), uuidText(tag)] as const),
        });
      }
      return {
        fold: sealed.fold, op: sealed.op, rec: sealed.rec, dev: sealed.dev, seq: sealed.seq, hlc: { ...sealed.hlc },
        epoch: sealed.epoch, schema: sealed.schema, table, fields: new Map(payload.f ?? []), sets,
      };
    },
  };
}
