import { decodeSnapshot, encodeSnapshot } from '@cashfold/protocol/snapshot';
import type { Id } from '../shared-kernel/id';
import type { SnapshotCodecPort, SnapshotData } from '../sync/application/snapshot';
import { createSyncClient, type SyncClient } from '../sync/application/sync-client';
import type { SyncCursorPort, TransportPort } from '../sync/ports/index';
import { createMemoryCursors } from './memory-ports';
import { MemoryRelay } from './relay';
import { createReplica, createWorld, id, type Replica } from './world';

export const SYNC_FOLD: Id = id(0xf0);

export interface Node {
  readonly replica: Replica;
  readonly client: SyncClient;
  readonly cursors: SyncCursorPort;
}

export async function setup(transportFor: (relay: MemoryRelay) => TransportPort = (r) => r.transport()) {
  const world = await createWorld();
  world.addFold(SYNC_FOLD);
  const relay = new MemoryRelay();
  const node = async (n: number, transport: TransportPort = transportFor(relay)): Promise<Node> => {
    const replica = await createReplica(world, { device: id(0xd0 + n) });
    const cursors = createMemoryCursors();
    const client = createSyncClient({ oplog: replica.oplog, writePath: replica.writePath, transport, cursors, clock: { nowMs: () => 1_700_000_000_000 } });
    relay.registerDevice(replica.device);
    return { replica, client, cursors };
  };
  return { world, relay, node };
}


/** The production byte format, for tests. */
export const snapshotCodec: SnapshotCodecPort = {
  encode: (data) => encodeSnapshot(data as never),
  decode: (bytes) => decodeSnapshot(bytes) as unknown as SnapshotData,
};
