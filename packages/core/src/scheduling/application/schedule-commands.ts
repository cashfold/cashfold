import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandContext, CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible, type FieldValue, type SetDelta } from '../../sync/domain/merge';
import type { ClockPort } from '../../sync/ports/index';
import { loadAccount, loadCategory, loadLabel, noSets, type NotFound } from '../../ledger/application/context';
import { setTo } from '../../ledger/domain/sets';
import { SCHEDULE_FIELD, TABLE } from '../../ledger/domain/tables';
import { occurrenceId, occurrencesUntil } from '../domain/occurrence';
import {
  decodeSchedule, scheduleFieldPatch, templateFieldPatch, validateSchedule, validateTemplate,
  type Schedule, type ScheduleError, type ScheduleInput, type ScheduleTemplate,
} from '../domain/schedule';
import { fromEpochMs } from '../../shared-kernel/local-date';

export type ScheduleCommandError = ScheduleError | NotFound | DomainError<'schedule_exists' | 'pattern_locked' | 'already_completed'>;

type Reading = Pick<CommandContext, 'reader'>;

/** A template must point at things that exist now; the entry rules are checked again each time an occurrence is created. */
async function checkReferences(ctx: Reading, fold: Id, t: ScheduleTemplate) {
  if (t.kind === 'transfer') {
    for (const account of [t.fromAccountId, t.toAccountId]) {
      const found = await loadAccount(ctx, fold, account);
      if (!found.ok) return found;
    }
    return ok(true as const);
  }
  const account = await loadAccount(ctx, fold, t.accountId);
  if (!account.ok) return account;
  if (t.categoryId !== null) {
    const category = await loadCategory(ctx, fold, t.categoryId);
    if (!category.ok) return category;
    if (category.value.direction !== t.direction) return err('category_direction_mismatch', 'The category is for the other kind of entry');
  }
  if (t.payeeId !== null) {
    const payee = await loadLabel(ctx, fold, t.payeeId, TABLE.payee);
    if (!payee.ok) return payee;
  }
  for (const tag of t.tagIds) {
    const found = await loadLabel(ctx, fold, tag, TABLE.tag);
    if (!found.ok) return found;
  }
  return ok(true as const);
}

function templateSets(existing: Parameters<typeof setTo>[0], t: ScheduleTemplate): Map<number, SetDelta> {
  return new Map([[SCHEDULE_FIELD.tagIds, setTo(existing, SCHEDULE_FIELD.tagIds, t.kind === 'transaction' ? t.tagIds : [])]]);
}

export type CreateScheduleCommand = { fold: Id; id: Id; template: ScheduleTemplate } & ScheduleInput;

export function createScheduleCommands({ clock }: { clock: ClockPort }) {
  const createSchedule: CommandDef<CreateScheduleCommand, Id, ScheduleCommandError | DomainError<'category_direction_mismatch'>> = {
    name: 'createSchedule',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('schedule_exists', 'A schedule with this id already exists');
      const { fold, id, template, ...input } = c;
      const valid = validateSchedule(input, template);
      if (!valid.ok) return valid;
      const refs = await checkReferences(ctx, fold, template);
      if (!refs.ok) return refs as never;
      const fields = new Map<number, FieldValue>([...scheduleFieldPatch({ ...valid.value, completedUtcMs: null }), ...templateFieldPatch(template)]);
      const written = await ctx.submit([{ fold, rec: id, table: TABLE.schedule, fields, sets: templateSets(undefined, template) }]);
      if (!written.ok) return written as never;
      return ok(id);
    },
  };

  /**
   * Edits a schedule. Occurrences already created are independent records and are not touched (FR-065). The
   * recurrence pattern (start date, unit, interval) is locked once the first occurrence exists, because occurrence
   * numbers and their record ids come from it; to change a pattern, finish the schedule and start another.
   */
  const updateSchedule: CommandDef<
    { fold: Id; id: Id; changes?: Partial<ScheduleInput>; template?: ScheduleTemplate },
    Schedule,
    ScheduleCommandError | DomainError<'category_direction_mismatch'>
  > = {
    name: 'updateSchedule',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const current = state !== undefined && state.table === TABLE.schedule && isVisible(state) ? decodeSchedule(c.id, state) : undefined;
      if (state === undefined || current === undefined) return err('not_found', 'That schedule does not exist');
      if (current.completedUtcMs !== null) return err('already_completed', 'A finished schedule cannot be edited');
      const ch = c.changes ?? {};
      const template = c.template ?? current.template;
      const next = { ...current, ...ch };
      const valid = validateSchedule(next, template);
      if (!valid.ok) return valid;

      const patternChanged = valid.value.beginLocalDate !== current.beginLocalDate || valid.value.unit !== current.unit || valid.value.interval !== current.interval;
      if (patternChanged) {
        const today = fromEpochMs(clock.nowMs(), 14 * 60);
        const records = await ctx.reader.listRecords(c.fold);
        const started = occurrencesUntil({ begin: current.beginLocalDate, unit: current.unit, interval: current.interval }, today, null).some((n) => records.has(occurrenceId(c.id, n)));
        if (started) return err('pattern_locked', 'Occurrences already exist. Finish this schedule and start a new one to change how it repeats');
      }
      if (c.template !== undefined) {
        const refs = await checkReferences(ctx, c.fold, c.template);
        if (!refs.ok) return refs as never;
      }

      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(valid.value) as Array<keyof typeof valid.value>) if (current[key] !== valid.value[key]) changed[key] = valid.value[key];
      const fields = scheduleFieldPatch(changed);
      let sets: ReadonlyMap<number, SetDelta> = noSets;
      if (c.template !== undefined) {
        const checked = validateTemplate(c.template);
        if (!checked.ok) return checked;
        for (const [k, v] of templateFieldPatch(c.template)) fields.set(k, v);
        sets = templateSets(state, c.template);
      }
      if (fields.size > 0 || sets.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.schedule, fields, sets }]);
        if (!written.ok) return written as never;
      }
      return ok({ ...current, ...valid.value, template });
    },
  };

  /** Ends the series: no further occurrence is created. Occurrences that exist stay. */
  const finishSchedule: CommandDef<{ fold: Id; id: Id }, true, NotFound> = {
    name: 'finishSchedule',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const current = state !== undefined && state.table === TABLE.schedule && isVisible(state) ? decodeSchedule(c.id, state) : undefined;
      if (current === undefined) return err('not_found', 'That schedule does not exist');
      if (current.completedUtcMs === null) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.schedule, fields: scheduleFieldPatch({ completedUtcMs: clock.nowMs() }), sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok(true as const);
    },
  };

  /** Deletes the schedule and with it every occurrence that was never created. Transactions it already made are kept. */
  const deleteSchedule: CommandDef<{ fold: Id; id: Id }, true, NotFound> = {
    name: 'deleteSchedule',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.schedule || !isVisible(state)) return err('not_found', 'That schedule does not exist');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.schedule, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  return { createSchedule, updateSchedule, finishSchedule, deleteSchedule };
}
