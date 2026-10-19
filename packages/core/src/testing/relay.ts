import type { Id } from '../shared-kernel/id';
import type { RelaySnapshot, SnapshotTransportPort } from '../sync/application/snapshot';
import type { PullResult, PushOutcome, SealedOp, TransportPort } from '../sync/ports/index';

/** An honest in-memory relay: an ordered, idempotent log of sealed ops per Fold. It never inspects content. */
export class MemoryRelay {
  private readonly logs = new Map<Id, { serverSeq: bigint; sealed: SealedOp }[]>();
  private readonly heads = new Map<Id, bigint>();
  private readonly snapshots = new Map<Id, RelaySnapshot>();
  private readonly acks = new Map<Id, Map<Id, bigint>>();
  private readonly devices = new Set<Id>();

  /** Devices that must acknowledge before the log below a snapshot may be dropped. */
  registerDevice(dev: Id): void {
    this.devices.add(dev);
  }

  push(fold: Id, ops: readonly SealedOp[]): PushOutcome[] {
    const log = this.logs.get(fold) ?? [];
    this.logs.set(fold, log);
    return ops.map((sealed): PushOutcome => {
      const existing = log.find((e) => e.sealed.op === sealed.op);
      if (existing !== undefined) return { op: sealed.op, serverSeq: existing.serverSeq, error: 'duplicate' };
      const serverSeq = (this.heads.get(fold) ?? 0n) + 1n;
      this.heads.set(fold, serverSeq);
      log.push({ serverSeq, sealed });
      return { op: sealed.op, serverSeq };
    });
  }

  pull(fold: Id, after: bigint, limit: number): PullResult {
    const log = this.logs.get(fold) ?? [];
    const rest = log.filter((e) => e.serverSeq > after);
    return { ops: rest.slice(0, limit), head: this.heads.get(fold) ?? 0n, more: rest.length > limit };
  }

  /** Ops currently held (after pruning). */
  size(fold: Id): number {
    return this.logs.get(fold)?.length ?? 0;
  }

  /** Drops ops below the snapshot once every registered device has acknowledged at least that far. */
  prune(fold: Id): number {
    const snap = this.snapshots.get(fold);
    if (snap === undefined) return 0;
    const acks = this.acks.get(fold) ?? new Map<Id, bigint>();
    for (const dev of this.devices) if ((acks.get(dev) ?? 0n) < snap.atSeq) return 0;
    const log = this.logs.get(fold) ?? [];
    const kept = log.filter((e) => e.serverSeq > snap.atSeq);
    this.logs.set(fold, kept);
    return log.length - kept.length;
  }

  snapshotTransport(device: Id): SnapshotTransportPort {
    return {
      put: async (fold, snapshot) => {
        if (snapshot.atSeq > (this.heads.get(fold) ?? 0n)) throw new Error('snapshot ahead of the log');
        this.snapshots.set(fold, snapshot);
      },
      get: async (fold) => this.snapshots.get(fold),
      ack: async (fold, seq) => {
        const acks = this.acks.get(fold) ?? new Map<Id, bigint>();
        acks.set(device, seq);
        this.acks.set(fold, acks);
        this.prune(fold);
      },
    };
  }

  transport(): TransportPort {
    return { push: async (fold, ops) => this.push(fold, ops), pull: async (fold, after, limit) => this.pull(fold, after, limit) };
  }
}
