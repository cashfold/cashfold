import { err, ok, type DomainError, type Result } from '../../shared-kernel/result.js';
import type { WireOp } from '../ports/index.js';

/** Brings an op from schema `n` to schema `n + 1`. Pure. */
export type UpcastStep = (op: WireOp) => WireOp;

export type UpcastError = DomainError<'schema_unsupported'>;

export interface Upcasters {
  readonly current: number;
  readonly oldest: number;
  /** Ops stamped with a schema this build cannot read (newer, or older than the oldest step) are refused. */
  upcast(op: WireOp): Result<WireOp, UpcastError>;
}

/**
 * Schemas are versioned and every older shape is upcast on read, so the op log stays replayable forever
 * (Constitution V). `steps` is keyed by the schema a step upgrades *from*; the chain must be gapless up to `current - 1`.
 */
export function createUpcasters(current: number, steps: ReadonlyMap<number, UpcastStep>): Upcasters {
  const from = [...steps.keys()].sort((a, b) => a - b);
  const oldest = from[0] ?? current;
  for (const v of from) if (v >= current) throw new Error(`upcast step from ${v} is not below the current schema ${current}`);
  for (let v = oldest; v < current; v++) if (!steps.has(v)) throw new Error(`gap in the upcast chain: no step from schema ${v}`);

  return {
    current,
    oldest,
    upcast(op) {
      if (op.schema > current || op.schema < oldest) {
        return err('schema_unsupported', `Schema ${op.schema} is outside the supported range ${oldest}..${current}`);
      }
      let out = op;
      while (out.schema < current) {
        const step = steps.get(out.schema)!;
        const next = step(out);
        if (next.schema !== out.schema + 1) throw new Error(`upcast step from ${out.schema} must advance the schema by exactly one`);
        out = next;
      }
      return ok(out);
    },
  };
}
