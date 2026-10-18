import type { Id } from '../shared-kernel/id';
import type { PullResult, PushOutcome, SealedOp, TransportPort } from '../sync/ports/index';

/** An honest in-memory relay: an ordered, idempotent log of sealed ops per Fold. It never inspects content. */
export class MemoryRelay {
  private readonly logs = new Map<Id, { serverSeq: bigint; sealed: SealedOp }[]>();

  push(fold: Id, ops: readonly SealedOp[]): PushOutcome[] {
    const log = this.logs.get(fold) ?? [];
    this.logs.set(fold, log);
    return ops.map((sealed): PushOutcome => {
      const existing = log.find((e) => e.sealed.op === sealed.op);
      if (existing !== undefined) return { op: sealed.op, serverSeq: existing.serverSeq, error: 'duplicate' };
      const serverSeq = BigInt(log.length + 1);
      log.push({ serverSeq, sealed });
      return { op: sealed.op, serverSeq };
    });
  }

  pull(fold: Id, after: bigint, limit: number): PullResult {
    const log = this.logs.get(fold) ?? [];
    const rest = log.filter((e) => e.serverSeq > after);
    return { ops: rest.slice(0, limit), head: BigInt(log.length), more: rest.length > limit };
  }

  size(fold: Id): number {
    return this.logs.get(fold)?.length ?? 0;
  }

  transport(): TransportPort {
    return { push: async (fold, ops) => this.push(fold, ops), pull: async (fold, after, limit) => this.pull(fold, after, limit) };
  }
}
