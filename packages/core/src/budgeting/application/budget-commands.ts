import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible, type SetDelta } from '../../sync/domain/merge';
import { loadLedger, noSets, type NotFound } from '../../ledger/application/context';
import { setTo } from '../../ledger/domain/sets';
import { BUDGET_FIELD, TABLE } from '../../ledger/domain/tables';
import { maxOf } from '../../ledger/domain/util';
import {
  budgetFieldPatch, decodeBudget, validateBudgetUpdate, validateNewBudget,
  type Budget, type BudgetChanges, type BudgetError, type BudgetScope, type NewBudgetInput,
} from '../domain/budget';

export type BudgetCommandError = BudgetError | NotFound | DomainError<'budget_exists' | 'unknown_scope_member' | 'unknown_funding_account'>;

/** A scope edit names the sets it replaces; the ones it leaves out are not touched. */
export type ScopeChanges = Partial<BudgetScope>;

const SCOPE_SET_FIELDS = [
  ['accountIds', BUDGET_FIELD.accountIds], ['groupIds', BUDGET_FIELD.groupIds], ['categoryIds', BUDGET_FIELD.categoryIds], ['tagIds', BUDGET_FIELD.tagIds],
] as const;

export function createBudgetCommands() {
  async function scopeProblem(ctx: Parameters<typeof loadLedger>[0], fold: Id, scope: ScopeChanges, funding: Id | null | undefined): Promise<BudgetCommandError | undefined> {
    const ledger = await loadLedger(ctx, fold);
    const known: Record<keyof Omit<BudgetScope, 'includeTransfers'>, ReadonlyMap<Id, unknown>> = {
      accountIds: ledger.accounts, groupIds: ledger.groups, categoryIds: ledger.categories, tagIds: ledger.tags,
    };
    for (const [key] of SCOPE_SET_FIELDS) {
      if ((scope[key] ?? []).some((member) => !known[key].has(member))) return { code: 'unknown_scope_member', message: 'A budget can only watch accounts, groups, categories and tags that exist' };
    }
    if (funding != null && !ledger.accounts.has(funding)) return { code: 'unknown_funding_account', message: 'The funding account does not exist' };
    return undefined;
  }

  const createBudget: CommandDef<{ fold: Id; id: Id; scope?: ScopeChanges } & NewBudgetInput, Id, BudgetCommandError> = {
    name: 'createBudget',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('budget_exists', 'A budget with this id already exists');
      const { fold, id, scope = {}, ...input } = c;
      let sortOrder = input.sortOrder;
      if (sortOrder === undefined) {
        const states = await ctx.reader.listRecords(fold);
        const existing = [...states].filter(([, s]) => s.table === TABLE.budget && isVisible(s)).map(([rec, s]) => decodeBudget(rec, s)?.sortOrder ?? 0);
        sortOrder = maxOf(existing, -1) + 1;
      }
      const valid = validateNewBudget({ ...input, sortOrder });
      if (!valid.ok) return valid;
      const problem = await scopeProblem(ctx, fold, scope, valid.value.fundedFromAccountId);
      if (problem !== undefined) return err(problem.code, problem.message) as never;
      const fields = budgetFieldPatch(valid.value);
      fields.set(BUDGET_FIELD.includeTransfers, scope.includeTransfers ?? false);
      const sets = new Map<number, SetDelta>();
      for (const [key, field] of SCOPE_SET_FIELDS) if ((scope[key] ?? []).length > 0) sets.set(field, setTo(undefined, field, scope[key] ?? []));
      const written = await ctx.submit([{ fold, rec: id, table: TABLE.budget, fields, sets }]);
      if (!written.ok) return written as never;
      return ok(id);
    },
  };

  const updateBudget: CommandDef<{ fold: Id; id: Id; changes?: BudgetChanges; scope?: ScopeChanges }, Budget, BudgetCommandError> = {
    name: 'updateBudget',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const current = state !== undefined && state.table === TABLE.budget && isVisible(state) ? decodeBudget(c.id, state) : undefined;
      if (state === undefined || current === undefined) return err('not_found', 'That budget does not exist');
      const valid = validateBudgetUpdate(current, c.changes ?? {});
      if (!valid.ok) return valid;
      const scope = c.scope ?? {};
      const problem = await scopeProblem(ctx, c.fold, scope, c.changes?.fundedFromAccountId);
      if (problem !== undefined) return err(problem.code, problem.message) as never;

      // Only what changed is written, so a concurrent edit of another field survives the merge (rollover: last writer wins).
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(valid.value) as Array<keyof typeof valid.value>) if (current[key] !== valid.value[key]) changed[key] = valid.value[key];
      const fields = budgetFieldPatch(changed);
      if (scope.includeTransfers !== undefined && scope.includeTransfers !== current.scope.includeTransfers) fields.set(BUDGET_FIELD.includeTransfers, scope.includeTransfers);
      const sets = new Map<number, SetDelta>();
      for (const [key, field] of SCOPE_SET_FIELDS) if (scope[key] !== undefined) sets.set(field, setTo(state, field, scope[key]));
      if (fields.size > 0 || sets.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.budget, fields, sets }]);
        if (!written.ok) return written as never;
      }
      return ok({ ...current, ...valid.value, scope: { ...current.scope, ...scope } });
    },
  };

  /** Deleting a budget removes only the plan; the transactions it watched are untouched. */
  const deleteBudget: CommandDef<{ fold: Id; id: Id }, true, NotFound> = {
    name: 'deleteBudget',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.budget || !isVisible(state)) return err('not_found', 'That budget does not exist');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.budget, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  return { createBudget, updateBudget, deleteBudget };
}
