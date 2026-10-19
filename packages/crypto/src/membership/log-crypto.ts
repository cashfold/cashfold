import { sha256 } from '@noble/hashes/sha2.js';
import { decodeLogEntry, encodeLogEntry, encodeLogEntryUnsigned, type LogEntry as WireLogEntry } from '@cashfold/protocol';
import type { SecretBuf } from '../secret-buf';
import type { Signer } from '../ports/index';

// Membership-log entries (ARCH 7.3): hash-chained and signed by the account key of whoever appends them.
//   hash = SHA-256(canonical(entry))                         -- over the whole entry, signature included
//   sig  = Ed25519("cashfold.log.v1" || canonical(entry without sig))
// The shape below is the plain form the core works with; this module is the only place it meets the wire format.

const SIGN_LABEL = new TextEncoder().encode('cashfold.log.v1');
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export type LogEntryType = WireLogEntry['type'];

/** The core's view of a log entry. Account ids are text, device ids are UUID text. */
export interface PlainLogEntry {
  readonly idx: number;
  readonly prev: Uint8Array;
  readonly type: LogEntryType;
  /** An account id, or a device id for `add_device` and `revoke_device`. */
  readonly subject: string;
  readonly role?: 1 | 2 | 3;
  readonly scope?: 'full' | 'from_join';
  readonly fromEpoch?: number;
  readonly server?: string;
  readonly pubkeys?: { readonly enc?: Uint8Array; readonly sig: Uint8Array };
  readonly epoch?: number;
  /** The account that signed the entry. */
  readonly signer: string;
  readonly ts: number;
  readonly sig: Uint8Array;
}

const DEVICE_TYPES: ReadonlySet<LogEntryType> = new Set(['add_device', 'revoke_device']);

function uuidBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new RangeError('not a UUID');
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
}

function uuidText(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function toWireEntry(e: PlainLogEntry): WireLogEntry {
  return {
    idx: BigInt(e.idx), prev: e.prev, type: e.type, subject: DEVICE_TYPES.has(e.type) ? uuidBytes(e.subject) : utf8(e.subject),
    ...(e.role !== undefined && { role: e.role }), ...(e.scope !== undefined && { scope: e.scope }), ...(e.fromEpoch !== undefined && { from_epoch: e.fromEpoch }),
    ...(e.server !== undefined && { server: e.server }), ...(e.pubkeys !== undefined && { pubkeys: { ...(e.pubkeys.enc !== undefined && { enc: e.pubkeys.enc }), sig: e.pubkeys.sig } }),
    ...(e.epoch !== undefined && { epoch: e.epoch }), signer: utf8(e.signer), ts: BigInt(e.ts), sig: e.sig,
  };
}

export function fromWireEntry(w: WireLogEntry): PlainLogEntry {
  return {
    idx: Number(w.idx), prev: w.prev, type: w.type, subject: DEVICE_TYPES.has(w.type) ? uuidText(w.subject) : fromUtf8(w.subject),
    ...(w.role !== undefined && { role: w.role as 1 | 2 | 3 }), ...(w.scope !== undefined && { scope: w.scope }), ...(w.from_epoch !== undefined && { fromEpoch: w.from_epoch }),
    ...(w.server !== undefined && { server: w.server }), ...(w.pubkeys !== undefined && { pubkeys: { ...(w.pubkeys.enc !== undefined && { enc: w.pubkeys.enc }), sig: w.pubkeys.sig } }),
    ...(w.epoch !== undefined && { epoch: w.epoch }), signer: fromUtf8(w.signer), ts: Number(w.ts), sig: w.sig,
  };
}

/** Canonical bytes of a whole entry: what the log stores and what the hash covers. */
export const encodeEntry = (e: PlainLogEntry): Uint8Array => encodeLogEntry(toWireEntry(e));
export const decodeEntry = (b: Uint8Array): PlainLogEntry => fromWireEntry(decodeLogEntry(b));

/** The bytes a signature covers: the label, then the canonical entry without its signature. */
export function entrySigningBytes(e: Omit<PlainLogEntry, 'sig'>): Uint8Array {
  const { sig, ...unsigned } = toWireEntry({ ...e, sig: new Uint8Array(64) });
  void sig;
  const body = encodeLogEntryUnsigned(unsigned);
  const out = new Uint8Array(SIGN_LABEL.length + body.length);
  out.set(SIGN_LABEL);
  out.set(body, SIGN_LABEL.length);
  return out;
}

export const hashEntry = (e: PlainLogEntry): Uint8Array => sha256(encodeEntry(e));

export interface LogCrypto {
  hash(entry: PlainLogEntry): Promise<Uint8Array>;
  verify(entry: PlainLogEntry, signerSigPk: Uint8Array): Promise<boolean>;
  /** Signs an entry as the account whose signing key is given. */
  sign(entry: Omit<PlainLogEntry, 'sig'>, signingKey: SecretBuf): Promise<PlainLogEntry>;
}

export function createLogCrypto({ signer }: { signer: Signer }): LogCrypto {
  return {
    async hash(entry) {
      return hashEntry(entry);
    },
    async verify(entry, pk) {
      const { sig, ...rest } = entry;
      return signer.verify(pk, entrySigningBytes(rest), sig);
    },
    async sign(entry, signingKey) {
      return { ...entry, sig: await signer.sign(signingKey, entrySigningBytes(entry)) };
    },
  };
}
