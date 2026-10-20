import type { Id } from '../../shared-kernel/id';
import { idFromBytes, idToBytes } from '../../shared-kernel/id';

// Small helpers for talking to the service. Ids go in paths as unpadded base64url of their 16 bytes.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

export const foldRef = (fold: Id): string => base64url(idToBytes(fold));

/** The id a service-side 16-byte value stands for, or undefined if it is not 16 bytes. */
export const idOfBytes = (v: unknown): Id | undefined => (v instanceof Uint8Array && v.length === 16 ? idFromBytes(v) : undefined);

/** A decoded CBOR map as a lookup, or an empty one for anything else. */
export const asMap = (v: unknown): ReadonlyMap<string, unknown> => (v instanceof Map ? (v as ReadonlyMap<string, unknown>) : new Map());
