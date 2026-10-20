import type { Id } from '../../shared-kernel/id';
import type { RecordState } from '../domain/merge';
import type { KeyStorePort, OpLogStore, ProjectionStore, SyncCursorPort } from '../ports/index';

// Client-encrypted snapshots (FR-082). A snapshot is the merged state of a Fold at one point of the relay's log. A new device
// starts from it instead of replaying every op; the relay may drop the ops below it once every active device has confirmed
// it holds a verified checkpoint. The relay only ever sees the sealed bytes.

export interface SnapshotData {
  /** For each device, the highest sequence number whose effect the snapshot contains. */
  readonly baseline: ReadonlyMap<Id, bigint>;
  readonly records: ReadonlyMap<Id, RecordState>;
}

/** The byte format of the payload. `decode` throws on anything malformed. */
export interface SnapshotCodecPort {
  encode(data: SnapshotData): Uint8Array;
  decode(bytes: Uint8Array): SnapshotData;
}

export interface SealedSnapshotPort {
  seal(ctx: { fold: Id; epoch: number; atSeq: bigint; dev: Id }, payload: Uint8Array): Promise<{ blob: Uint8Array; sig: Uint8Array }>;
  /** Verifies the signature, then the AEAD tag. Rejects with an Error carrying `kind` when either fails. */
  open(ctx: { fold: Id; epoch: number; atSeq: bigint }, sealed: { blob: Uint8Array; sig: Uint8Array }): Promise<{ payload: Uint8Array; dev: Id }>;
}

export interface RelaySnapshot {
  readonly atSeq: bigint;
  readonly epoch: number;
  readonly blob: Uint8Array;
  readonly sig: Uint8Array;
}

export interface SnapshotTransportPort {
  put(fold: Id, snapshot: RelaySnapshot): Promise<void>;
  get(fold: Id): Promise<RelaySnapshot | undefined>;
  /** "I hold everything up to `seq`" (and have verified the snapshot, if there is one). */
  ack(fold: Id, seq: bigint): Promise<void>;
}

export type PublishResult = 'published' | 'not_ready' | 'no_key' | 'failed';
export type BootstrapResult = 'installed' | 'none' | 'refused' | 'not_empty' | 'failed';

export interface SnapshotService {
  /**
   * Seals the current state as a checkpoint at the relay position this device has reached. Only when everything this device
   * wrote is already on the relay, so the checkpoint matches the relay's log.
   */
  publish(fold: Id): Promise<PublishResult>;
  /** Starts a device with no history of the Fold from the relay's snapshot. A snapshot that does not verify is ignored. */
  bootstrap(fold: Id): Promise<BootstrapResult>;
  /** Confirms to the relay how far this device has got, which is what lets it prune. */
  acknowledge(fold: Id): Promise<boolean>;
}

export function createSnapshotService(deps: {
  codec: SnapshotCodecPort;
  oplog: OpLogStore;
  projections: ProjectionStore;
  cursors: SyncCursorPort;
  keys: KeyStorePort;
  sealer: SealedSnapshotPort;
  transport: SnapshotTransportPort;
}): SnapshotService {
  const { codec, oplog, projections, cursors, keys, sealer, transport } = deps;

  return {
    async publish(fold) {
      const epoch = await keys.currentEpoch(fold);
      if (epoch === undefined) return 'no_key';
      const { serverSeq } = await cursors.get(fold);
      if (serverSeq === 0n || (await oplog.listPending(fold)).length > 0) return 'not_ready';
      const baseline = new Map<Id, bigint>();
      for (const { sealed } of await oplog.list(fold)) if (sealed.seq > (baseline.get(sealed.dev) ?? 0n)) baseline.set(sealed.dev, sealed.seq);
      const payload = codec.encode({ baseline, records: await projections.listRecords(fold) });
      try {
        const { blob, sig } = await sealer.seal({ fold, epoch, atSeq: serverSeq, dev: keys.deviceId() }, payload);
        await transport.put(fold, { atSeq: serverSeq, epoch, blob, sig });
        return 'published';
      } catch {
        return 'failed';
      }
    },

    async bootstrap(fold) {
      if ((await oplog.list(fold)).length > 0 || (await cursors.get(fold)).serverSeq > 0n) return 'not_empty';
      let snap: RelaySnapshot | undefined;
      try {
        snap = await transport.get(fold);
      } catch {
        return 'failed';
      }
      if (snap === undefined) return 'none';
      let data: SnapshotData;
      try {
        const opened = await sealer.open({ fold, epoch: snap.epoch, atSeq: snap.atSeq }, snap);
        data = codec.decode(opened.payload);
      } catch {
        return 'refused'; // a forged, swapped, rolled-back-to-another-Fold or damaged snapshot: ignore it, sync from the log
      }
      await projections.transaction(async () => {
        for (const [rec, state] of data.records) await projections.putRecord(fold, rec, state);
      });
      await cursors.set(fold, { serverSeq: snap.atSeq, fromSnapshot: true });
      return 'installed';
    },

    async acknowledge(fold) {
      const { serverSeq } = await cursors.get(fold);
      if (serverSeq === 0n) return false;
      try {
        await transport.ack(fold, serverSeq);
        return true;
      } catch {
        return false;
      }
    },
  };
}
