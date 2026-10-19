import { encode } from '@cashfold/protocol/cbor';
import { AeadError, type Aead, type Hkdf, type Rng } from '../ports/index';
import type { SecretBuf } from '../secret-buf';

// ARCH 5.6:
//   RK    = HKDF-SHA256(salt = record_id, IKM = FK[epoch], info = "cashfold.rec.v1", L = 32)
//   nonce = CSPRNG(12), fresh on every encryption
//   AAD   = CBOR ["cashfold.rec.v1", fold_id, record_id, table, epoch, schema]
//   blob  = nonce(12) || AES-256-GCM(RK, nonce, AAD, pad(payload)) -- ciphertext || tag(16)

const LABEL = 'cashfold.rec.v1';
const LABEL_BYTES = Uint8Array.from(LABEL, (c) => c.charCodeAt(0));
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PAD_BLOCK = 256;
const MAX_TABLE_CODE = 14;

export interface RecordContext {
  readonly foldId: Uint8Array;
  readonly recordId: Uint8Array;
  /** Table code, u8. */
  readonly table: number;
  /** Key epoch, u32. */
  readonly epoch: number;
  /** Schema version, u16. */
  readonly schema: number;
}

export type RecordLocation = Omit<RecordContext, 'table'>;

function checkInt(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${name} out of range`);
}

function validate(ctx: RecordContext): void {
  if (ctx.foldId.length !== 16) throw new RangeError('fold id must be 16 bytes');
  if (ctx.recordId.length !== 16) throw new RangeError('record id must be 16 bytes');
  checkInt('table', ctx.table, 0xff);
  checkInt('epoch', ctx.epoch, 0xffff_ffff);
  checkInt('schema', ctx.schema, 0xffff);
}

const aadFor = (ctx: RecordContext): Uint8Array => encode([LABEL, ctx.foldId, ctx.recordId, ctx.table, ctx.epoch, ctx.schema]);

/** 4-byte big-endian length, payload, then zeros up to a multiple of 256 bytes (hides length within a bucket). */
export function pad(payload: Uint8Array): Uint8Array {
  const total = Math.ceil((4 + payload.length) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, payload.length);
  out.set(payload, 4);
  return out;
}

/** Strict inverse of `pad`: canonical padding only, so every payload has exactly one valid padded form. */
export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < PAD_BLOCK || padded.length % PAD_BLOCK !== 0) throw new AeadError();
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (4 + length > padded.length || Math.ceil((4 + length) / PAD_BLOCK) * PAD_BLOCK !== padded.length) throw new AeadError();
  for (let i = 4 + length; i < padded.length; i++) if (padded[i] !== 0) throw new AeadError();
  return padded.slice(4, 4 + length);
}

export interface RecordCrypto {
  seal(foldKey: SecretBuf, ctx: RecordContext, payload: Uint8Array): Promise<Uint8Array>;
  open(foldKey: SecretBuf, ctx: RecordContext, blob: Uint8Array): Promise<Uint8Array>;
  /**
   * The table code lives inside the encrypted payload, so a receiver of a record it has not seen
   * before cannot know it. Tries each valid table code (1..14); only the true one authenticates.
   */
  openDiscoveringTable(foldKey: SecretBuf, location: RecordLocation, blob: Uint8Array): Promise<{ table: number; payload: Uint8Array }>;
}

export function createRecordCrypto({ aead, hkdf, rng }: { aead: Aead; hkdf: Hkdf; rng: Rng }): RecordCrypto {
  const recordKey = (foldKey: SecretBuf, recordId: Uint8Array): Promise<SecretBuf> => hkdf.derive(foldKey, recordId, LABEL_BYTES, 32);

  async function open(foldKey: SecretBuf, ctx: RecordContext, blob: Uint8Array): Promise<Uint8Array> {
    validate(ctx);
    if (blob.length < NONCE_BYTES + TAG_BYTES) throw new AeadError();
    const rk = await recordKey(foldKey, ctx.recordId);
    try {
      const padded = await aead.open(rk, blob.slice(0, NONCE_BYTES), blob.slice(NONCE_BYTES), aadFor(ctx));
      return unpad(padded);
    } finally {
      rk.wipe();
    }
  }

  return {
    async seal(foldKey, ctx, payload) {
      validate(ctx);
      const rk = await recordKey(foldKey, ctx.recordId);
      try {
        const nonce = Uint8Array.from(rng.bytes(NONCE_BYTES));
        const sealed = await aead.seal(rk, nonce, pad(payload), aadFor(ctx));
        const blob = new Uint8Array(NONCE_BYTES + sealed.length);
        blob.set(nonce);
        blob.set(sealed, NONCE_BYTES);
        return blob;
      } finally {
        rk.wipe();
      }
    },

    open,

    async openDiscoveringTable(foldKey, location, blob) {
      for (let table = 1; table <= MAX_TABLE_CODE; table++) {
        try {
          return { table, payload: await open(foldKey, { ...location, table }, blob) };
        } catch (e) {
          if (!(e instanceof AeadError)) throw e;
        }
      }
      throw new AeadError();
    },
  };
}
