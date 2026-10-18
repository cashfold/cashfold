import type { Id } from '../shared-kernel/id';
import type { Role } from '../shared-kernel/role';
import { buildLedger, type Ledger } from '../ledger/application/projections/ledger';
import { LEDGER_GROUPS } from '../ledger/domain/ledger-groups';
import { foldSettingsPatch, settingsRecordId } from '../sharing/domain/fold';
import {
  createCommandBus, createEventBus, createQueryBus, type CommandDef, type DomainEvent, type QueryDef,
} from '../sync/application/buses';
import type { DomainError, Result } from '../shared-kernel/result';
import { createReplica, createWorld, id, type Replica } from './world';

export const FOLD = id(0xf0);

export interface LedgerHarness {
  readonly fold: Id;
  readonly replica: Replica;
  readonly events: DomainEvent[];
  /** The clock the commands read (ms). Move it with `setNow`, which moves the write path's clock too. */
  readonly clock: { now: number };
  setNow(ms: number): void;
  setRole(role: Role | undefined): void;
  run<C, R, E extends DomainError>(def: CommandDef<C, R, E>, command: C): ReturnType<ReturnType<typeof createCommandBus>['execute']> extends Promise<infer X> ? Promise<X> : never;
  ask<Q, R>(def: QueryDef<Q, R>, query: Q): Promise<Result<R, DomainError>>;
  ledger(): Promise<Ledger>;
}

/** One device, one Fold with a base currency, real sealing and storage in memory, and the command and query buses. */
export async function ledgerHarness(opts: { role?: Role; baseCurrency?: string } = {}): Promise<LedgerHarness> {
  const world = await createWorld();
  world.addFold(FOLD);
  const replica = await createReplica(world, { device: id(0xa), groups: LEDGER_GROUPS, nowMs: 1_800_000_000_000 });
  const events = createEventBus();
  const seen: DomainEvent[] = [];
  events.subscribe((e) => seen.push(e));
  let role: Role | undefined = opts.role ?? 'owner';
  const deps = { writePath: replica.writePath, projections: replica.projections, events, roleOf: async () => role, isUnlocked: () => true };
  const commands = createCommandBus(deps);
  const queries = createQueryBus(deps);
  const clock = { now: 1_800_000_000_000 };

  const base = foldSettingsPatch({ name: 'Home', baseCurrency: opts.baseCurrency ?? 'USD' });
  await replica.writePath.submit({ fold: FOLD, rec: settingsRecordId(FOLD), table: base.table, fields: base.fields, sets: new Map() });

  return {
    fold: FOLD,
    replica,
    events: seen,
    clock,
    setNow: (ms) => {
      clock.now = ms;
      replica.setNow(ms);
    },
    setRole: (r) => {
      role = r;
    },
    run: ((def: never, command: never) => commands.execute(def, command)) as LedgerHarness['run'],
    ask: (def, query) => queries.execute(def, query),
    ledger: async () => buildLedger(await replica.projections.listRecords(FOLD)),
  };
}
