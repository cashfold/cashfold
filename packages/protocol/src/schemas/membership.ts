import { z } from 'zod';
import { decode, encode } from '../cbor/cbor';
import { anyBytes, bytes, hash32, intRange, pk32, sig64, stripUndefined, textRecord, u32, u64, uuid16 } from './primitives';

export const LOG_ENTRY_TYPES = ['add_member', 'remove_member', 'leave', 'change_role', 'add_device', 'revoke_device', 'rotate_epoch', 'set_server'] as const;

export const LogEntrySchema = textRecord({
  idx: u64,
  prev: hash32,
  type: z.enum(LOG_ENTRY_TYPES),
  subject: anyBytes,
  role: intRange(1n, 3n).optional(),
  scope: z.enum(['full', 'from_join']).optional(),
  from_epoch: u32.optional(),
  server: z.string().optional(),
  pubkeys: textRecord({ enc: pk32, sig: pk32 }).optional(),
  epoch: u32.optional(),
  signer: anyBytes,
  ts: u64,
  sig: sig64,
});

export type LogEntry = z.output<typeof LogEntrySchema>;

export const SnapshotSchema = textRecord({
  fold: uuid16,
  at_seq: u64,
  epoch: u32,
  blob: anyBytes,
  sig: sig64,
});

export type Snapshot = z.output<typeof SnapshotSchema>;

const wire = <T extends Record<string, unknown>>(value: T) => encode(stripUndefined(value) as never);

export const encodeLogEntry = (e: LogEntry): Uint8Array => wire(e);
export const decodeLogEntry = (b: Uint8Array): LogEntry => LogEntrySchema.parse(decode(b));
export const encodeSnapshot = (s: Snapshot): Uint8Array => wire(s);
export const decodeSnapshot = (b: Uint8Array): Snapshot => SnapshotSchema.parse(decode(b));

// ---------------------------------------------------------------- transport frame (integer keys 1..4)

import { intMapToObject } from './primitives';

export const FrameSchema = z
  .preprocess(
    intMapToObject,
    z.object({ '1': bytes(16), '2': intRange(0n, 1n), '3': u64, '4': anyBytes }).strict(),
  )
  .transform((w) => ({ session: w['1'], direction: w['2'] as 0 | 1, counter: w['3'], body: w['4'] }));

export type Frame = z.output<typeof FrameSchema>;

export const encodeFrame = (f: Frame): Uint8Array =>
  encode(new Map<bigint, unknown>([[1n, f.session], [2n, f.direction], [3n, f.counter], [4n, f.body]]) as never);
export const decodeFrame = (b: Uint8Array): Frame => FrameSchema.parse(decode(b));
