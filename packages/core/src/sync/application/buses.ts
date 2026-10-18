import type { Id } from '../../shared-kernel/id';
import { ok, type DomainError, type Result } from '../../shared-kernel/result';
import { roleAtLeast, type Role } from '../../shared-kernel/role';
import { DELETED_FIELD, isVisible, visibleMembers, type RecordState } from '../domain/merge';
import type { ProjectionStore } from '../ports/index';
import type { Applied, OpDraft, WriteError, WritePath } from './write-path';

// CQRS plumbing. Commands go through the write path and append ops; queries read projections and never mutate.
// Every command runs in one transaction and publishes its domain events only after it commits (core-api.md).

export type BusError = DomainError<'permission_denied' | 'locked'> & { readonly roleRequired?: Role };

export interface ProjectionReader {
  getRecord: ProjectionStore['getRecord'];
  listRecords: ProjectionStore['listRecords'];
}

export interface CommandContext {
  submit(drafts: readonly OpDraft[]): Promise<Result<readonly Applied[], WriteError>>;
  readonly reader: ProjectionReader;
}

export interface QueryContext {
  readonly reader: ProjectionReader;
}

export interface CommandDef<C, R, E extends DomainError> {
  readonly name: string;
  /** The least role allowed, or null for commands that create the thing the role belongs to (a new Fold). */
  readonly requires: Role | null;
  foldOf(command: C): Id;
  handle(command: C, ctx: CommandContext): Promise<Result<R, E>>;
}

export interface QueryDef<Q, R> {
  readonly name: string;
  readonly requires: Role;
  foldOf(query: Q): Id;
  read(query: Q, ctx: QueryContext): Promise<R>;
}

// ---------------------------------------------------------------- domain events

export type DomainEventType = 'RecordCreated' | 'RecordChanged' | 'RecordDeleted' | 'RecordRestored';

/** Generic record-level event derived from a projection diff. Contexts map these to their named events. */
export interface DomainEvent {
  readonly type: DomainEventType;
  readonly fold: Id;
  readonly rec: Id;
  readonly table: number;
  readonly changedFields: readonly number[];
  readonly changedSets: readonly number[];
}

function diffFields(before: RecordState | undefined, after: RecordState): number[] {
  const ids = new Set([...(before?.fields.keys() ?? []), ...after.fields.keys()]);
  ids.delete(DELETED_FIELD);
  return [...ids].filter((id) => before?.fields.get(id)?.opId !== after.fields.get(id)?.opId).sort((a, b) => a - b);
}

function diffSets(before: RecordState | undefined, after: RecordState): number[] {
  const ids = new Set([...(before?.sets.keys() ?? []), ...after.sets.keys()]);
  return [...ids]
    .filter((id) => {
      const was = before === undefined ? new Set<Id>() : visibleMembers(before, id);
      const now = visibleMembers(after, id);
      return was.size !== now.size || [...now].some((m) => !was.has(m));
    })
    .sort((a, b) => a - b);
}

/** Domain events as the difference between projected state before and after an op was applied. */
export function deriveEvents(fold: Id, applied: Pick<Applied, 'op' | 'before' | 'after'>): DomainEvent[] {
  const { op, before, after } = applied;
  const visibleBefore = before !== undefined && isVisible(before);
  const visibleAfter = isVisible(after);
  const changedFields = diffFields(before, after);
  const changedSets = diffSets(before, after);
  const base = { fold, rec: op.rec, table: after.table, changedFields, changedSets };

  if (!visibleBefore && visibleAfter) {
    const hadContent = before !== undefined && [...before.fields.keys()].some((id) => id !== DELETED_FIELD);
    return [{ type: hadContent ? 'RecordRestored' : 'RecordCreated', ...base }];
  }
  if (visibleBefore && !visibleAfter) return [{ type: 'RecordDeleted', ...base }];
  if (visibleBefore && visibleAfter && (changedFields.length > 0 || changedSets.length > 0)) return [{ type: 'RecordChanged', ...base }];
  return [];
}

export interface EventBus {
  subscribe(listener: (event: DomainEvent) => void): () => void;
  publish(events: readonly DomainEvent[]): void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<(event: DomainEvent) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(events) {
      for (const event of events) {
        for (const listener of [...listeners]) {
          try {
            listener(event);
          } catch {
            // A faulty subscriber must not stop the others or fail the command that already committed.
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------- buses

export interface BusDeps {
  readonly writePath: WritePath;
  readonly projections: ProjectionStore;
  readonly events: EventBus;
  /** The caller's role in the Fold, from the verified membership log; undefined for non-members. */
  roleOf(fold: Id): Promise<Role | undefined>;
  isUnlocked(): boolean;
}

async function authorise(deps: BusDeps, fold: Id, required: Role | null): Promise<BusError | undefined> {
  if (!deps.isUnlocked()) return { code: 'locked', message: 'The app is locked' };
  if (required === null) return undefined;
  const role = await deps.roleOf(fold);
  if (role === undefined || !roleAtLeast(role, required)) {
    return { code: 'permission_denied', message: 'Your role does not allow this action', roleRequired: required };
  }
  return undefined;
}

const readerOf = (projections: ProjectionStore): ProjectionReader => ({
  getRecord: (fold, rec) => projections.getRecord(fold, rec),
  listRecords: (fold) => projections.listRecords(fold),
});

export interface CommandBus {
  execute<C, R, E extends DomainError>(def: CommandDef<C, R, E>, command: C): Promise<Result<R, E | BusError>>;
}

export interface QueryBus {
  execute<Q, R>(def: QueryDef<Q, R>, query: Q): Promise<Result<R, BusError>>;
}

/** Thrown inside the command transaction to roll it back when the handler returns an error result. */
class Rollback extends Error {}

export function createCommandBus(deps: BusDeps): CommandBus {
  return {
    async execute<C, R, E extends DomainError>(def: CommandDef<C, R, E>, command: C): Promise<Result<R, E | BusError>> {
      const denied = await authorise(deps, def.foldOf(command), def.requires);
      if (denied !== undefined) return { ok: false, error: denied };

      const applied: Applied[] = [];
      const ctx: CommandContext = {
        reader: readerOf(deps.projections),
        async submit(drafts) {
          const result = await deps.writePath.submitMany(drafts);
          if (result.ok) applied.push(...result.value);
          return result;
        },
      };

      // One transaction for the whole command: an error result rolls back everything the handler wrote.
      const failure: { result?: Result<R, E> } = {};
      let result: Result<R, E>;
      try {
        result = await deps.projections.transaction(async () => {
          const r = await def.handle(command, ctx);
          if (!r.ok) {
            failure.result = r;
            throw new Rollback();
          }
          return r;
        });
      } catch (e) {
        if (e instanceof Rollback && failure.result !== undefined) return failure.result;
        throw e;
      }

      deps.events.publish(applied.flatMap((a) => deriveEvents(a.sealed.fold, a)));
      return result;
    },
  };
}

export function createQueryBus(deps: BusDeps): QueryBus {
  return {
    async execute(def, query) {
      const denied = await authorise(deps, def.foldOf(query), def.requires);
      if (denied !== undefined) return { ok: false, error: denied };
      return ok(await def.read(query, { reader: readerOf(deps.projections) }));
    },
  };
}
