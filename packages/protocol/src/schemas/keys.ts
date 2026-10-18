import { z } from 'zod';
import { decode, encode } from '../cbor/cbor';
import { aeadCt, anyBytes, bytes, intRange, pk32, sig64, stripUndefined, textRecord, uuid16 } from './primitives';

const ALG_HPKE = 'HPKE-X25519-HKDF-SHA256-AES256GCM';

const argon2id = textRecord({
  kdf: z.literal('argon2id'),
  m_kib: intRange(32_768n, 0xffff_ffffn),
  t: intRange(2n, 255n),
  p: intRange(1n, 255n),
  v: z.literal(19n).transform(() => 19 as const),
  enc_salt: bytes(16),
});

const pbkdf2 = textRecord({
  kdf: z.literal('pbkdf2-hmac-sha256'),
  iter: intRange(600_000n, 0xffff_ffffn),
  enc_salt: bytes(16),
});

export const KdfParamsSchema = z.union([argon2id, pbkdf2]);

export const KeySetSchema = textRecord({
  v: z.literal(1n).transform(() => 1 as const),
  uuid: uuid16,
  enc: textRecord({ alg: z.literal(ALG_HPKE), pk: pk32, sk_ct: aeadCt }),
  sig: textRecord({ alg: z.literal('Ed25519'), pk: pk32, sk_ct: aeadCt }),
  kdf: KdfParamsSchema,
  encrypted_by: z.literal('mp'),
});

export type KeySet = z.output<typeof KeySetSchema>;

export const FoldKeyGrantSchema = textRecord({
  fold: uuid16,
  epoch: intRange(0n, 0xffff_ffffn),
  member: anyBytes,
  role: intRange(1n, 3n),
  enc: pk32,
  ct: bytes(48),
  granted_by: anyBytes,
  sig: sig64,
});

export type FoldKeyGrant = z.output<typeof FoldKeyGrantSchema>;

const wire = <T extends Record<string, unknown>>(value: T) => encode(stripUndefined(value) as never);

export const encodeKeySet = (k: KeySet): Uint8Array => wire(k);
export const decodeKeySet = (b: Uint8Array): KeySet => KeySetSchema.parse(decode(b));
export const encodeFoldKeyGrant = (g: FoldKeyGrant): Uint8Array => wire(g);
export const decodeFoldKeyGrant = (b: Uint8Array): FoldKeyGrant => FoldKeyGrantSchema.parse(decode(b));
