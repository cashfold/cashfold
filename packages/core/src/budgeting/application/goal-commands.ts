import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandContext, CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible } from '../../sync/domain/merge';
import { loadAccount, noSets, type NotFound } from '../../ledger/application/context';
import { TABLE } from '../../ledger/domain/tables';
import { decodeGoal, goalFieldPatch, validateGoal, type Goal, type GoalError, type NewGoalInput } from '../domain/goal';
import { buildGoals } from './goal-queries';

export type GoalCommandError = GoalError | NotFound | DomainError<'goal_exists' | 'not_a_goal_account' | 'account_has_goal'>;

type Reading = Pick<CommandContext, 'reader'>;

/** The goal's account must be a goal account that no other goal uses (FR-029, FR-067). */
async function checkAccount(ctx: Reading, fold: Id, account: Id, self: Id | undefined) {
  const found = await loadAccount(ctx, fold, account);
  if (!found.ok) return found;
  if (found.value.kind !== 'goal') return err('not_a_goal_account', 'A goal is saved in a goal account');
  const taken = [...buildGoals(await ctx.reader.listRecords(fold)).values()].some((g) => g.accountId === account && g.id !== self);
  return taken ? err('account_has_goal', 'That goal account already has a goal') : ok(found.value);
}

export function createGoalCommands() {
  const addGoal: CommandDef<{ fold: Id; id: Id } & NewGoalInput, Id, GoalCommandError> = {
    name: 'addGoal',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('goal_exists', 'A goal with this id already exists');
      const { fold, id, ...input } = c;
      const valid = validateGoal(input);
      if (!valid.ok) return valid;
      const account = await checkAccount(ctx, fold, valid.value.accountId, undefined);
      if (!account.ok) return account;
      const written = await ctx.submit([{ fold, rec: id, table: TABLE.goal, fields: goalFieldPatch(valid.value), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(id);
    },
  };

  const updateGoal: CommandDef<{ fold: Id; id: Id; changes: Partial<NewGoalInput> }, Goal, GoalCommandError> = {
    name: 'updateGoal',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const current = state !== undefined && state.table === TABLE.goal && isVisible(state) ? decodeGoal(c.id, state) : undefined;
      if (current === undefined) return err('not_found', 'That goal does not exist');
      const valid = validateGoal({ ...current, ...c.changes });
      if (!valid.ok) return valid;
      if (valid.value.accountId !== current.accountId) {
        const account = await checkAccount(ctx, c.fold, valid.value.accountId, c.id);
        if (!account.ok) return account;
      }
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(valid.value) as Array<keyof typeof valid.value>) if (current[key] !== valid.value[key]) changed[key] = valid.value[key];
      const fields = goalFieldPatch(changed);
      if (fields.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.goal, fields, sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok({ ...current, ...valid.value });
    },
  };

  /** Deleting a goal leaves its account and the money in it alone. */
  const deleteGoal: CommandDef<{ fold: Id; id: Id }, true, NotFound> = {
    name: 'deleteGoal',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.goal || !isVisible(state)) return err('not_found', 'That goal does not exist');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.goal, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  return { addGoal, updateGoal, deleteGoal };
}
