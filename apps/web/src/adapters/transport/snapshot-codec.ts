import type { SnapshotCodecPort, SnapshotData } from '@cashfold/core';
import { decodeSnapshot, encodeSnapshot } from '@cashfold/protocol/snapshot';

/** The byte format of a snapshot's payload. Ids are the same canonical text on both sides, so the shapes line up exactly. */
export const snapshotCodec: SnapshotCodecPort = {
  encode: (data) => encodeSnapshot(data as never),
  decode: (bytes) => decodeSnapshot(bytes) as unknown as SnapshotData,
};
