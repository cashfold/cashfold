import { decode } from '@cashfold/protocol/cbor';
import { z } from 'zod';
import type { KdfRecord } from '../store/store.js';

// Request bodies the relay accepts, as zod schemas over decoded CBOR (integers arrive as bigint, maps as Map). Every
// byte string has an exact length. A body that does not match is refused with one generic error, never a description.

const anyBytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'bytes' });
const bytes = (n: number) => anyBytes.refine((b) => b.length === n);
const uuid16 = bytes(16);
const int = (min: number, max: number) => z.bigint().gte(BigInt(min)).lte(BigInt(max)).transform(Number);
export const textMap = <S extends z.ZodRawShape>(shape: S) =>
  z.preprocess((v) => (v instanceof Map && [...v.keys()].every((k) => typeof k === 'string') ? Object.fromEntries(v) : v), z.object(shape).strict());

const accountId = z.string().regex(/^[A-Z2-9]{6}$/);
const email = z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

export const KdfWire = z.union([
  textMap({ kdf: z.literal('argon2id'), m_kib: int(32_768, 0xffff_ffff), t: int(2, 255), p: int(1, 255), enc_salt: uuid16 }),
  textMap({ kdf: z.literal('pbkdf2-hmac-sha256'), iter: int(600_000, 0xffff_ffff), enc_salt: uuid16 }),
]);
export type KdfWireValue = z.output<typeof KdfWire>;

export const kdfToRecord = (k: KdfWireValue): KdfRecord =>
  k.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: k.m_kib, t: k.t, p: k.p, encSalt: k.enc_salt } : { kdf: 'pbkdf2-hmac-sha256', iter: k.iter, encSalt: k.enc_salt };

export const kdfToWire = (k: KdfRecord): Record<string, unknown> =>
  k.kdf === 'argon2id'
    ? { kdf: k.kdf, m_kib: BigInt(k.mKib ?? 0), t: BigInt(k.t ?? 0), p: BigInt(k.p ?? 0), enc_salt: k.encSalt }
    : { kdf: k.kdf, iter: BigInt(k.iter ?? 0), enc_salt: k.encSalt };

export const HelloBody = textMap({ email, device_id: uuid16 });
export const ProofABody = textMap({ session_id: uuid16, A: bytes(512) });
export const ProofM1Body = textMap({ session_id: uuid16, M1: bytes(32) });

export const DeviceLabelBody = textMap({ label_ct: anyBytes.refine((b) => b.length <= 256).nullable() });
export const DeviceBody = textMap({ dev_id: uuid16, sig_pk: bytes(32), label_ct: anyBytes.optional() });

export const RegistrationBody = textMap({
  account_id: accountId, email, auth_salt: uuid16, kdf: KdfWire, srp_verifier: bytes(512), keyset: anyBytes.refine((b) => b.length > 0 && b.length <= 4096), device: DeviceBody,
  discoverable: z.boolean().optional(),
});

export const CredentialRotationBody = textMap({ auth_salt: uuid16, kdf: KdfWire, srp_verifier: bytes(512), keyset: anyBytes.refine((b) => b.length > 0 && b.length <= 4096) });

export const VerifyEmailBody = textMap({ token: z.union([z.string().min(16).max(128), anyBytes.refine((b) => b.length >= 16 && b.length <= 64)]) });
export const DiscoverableBody = textMap({ discoverable: z.boolean() });

export const CreateFoldBody = textMap({ fold: uuid16, genesis: anyBytes.optional(), grant: anyBytes.optional() });

export const SnapshotBody = textMap({ fold: uuid16, at_seq: z.bigint().gte(0n).lte(2n ** 63n - 1n), epoch: int(0, 0xffff_ffff), blob: anyBytes, sig: bytes(64) });
export const AckBody = textMap({ seq: z.bigint().gte(0n).lte(2n ** 63n - 1n) });

export class BadRequest extends Error {
  constructor() {
    super('bad_request');
  }
}

/** Decodes a CBOR body and checks it against a schema. Any failure is the same `BadRequest`. */
export function parseBody<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  if (!(raw instanceof Uint8Array)) throw new BadRequest();
  let value: unknown;
  try {
    value = decode(raw);
  } catch {
    throw new BadRequest();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequest();
  return parsed.data;
}

export function parseValue<S extends z.ZodTypeAny>(value: unknown, schema: S): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequest();
  return parsed.data;
}
