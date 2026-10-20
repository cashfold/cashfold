import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef, QueryDef } from '../../sync/application/buses';
import { DELETED_FIELD, type FieldValue, type SetDelta } from '../../sync/domain/merge';
import { categoryFieldPatch, validateCategoryMove, validateNewCategory, type CategoryError, type Direction, type NewCategory } from '../domain/category';
import { defaultCategories } from '../domain/default-categories';
import { labelFieldPatch, labelKey, validateLabelName, type LabelError } from '../domain/label';
import { setTo } from '../domain/sets';
import { TABLE, TXN_FIELD } from '../domain/tables';
import { maxOf } from '../domain/util';
import { loadCategory, loadLabel, loadLedger, noSets, type NotFound } from './context';

export type CategoryCommandError = CategoryError | NotFound | DomainError<'category_exists' | 'category_in_use' | 'merge_into_self' | 'merge_direction_mismatch'>;
export type LabelCommandError = LabelError | NotFound | DomainError<'label_exists' | 'merge_into_self'>;

export interface CategoryChanges {
  readonly name?: string;
  readonly icon?: string | null;
  readonly color?: number;
  readonly sortOrder?: number;
  readonly archived?: boolean;
}

export function createCategoryCommands() {
  const createCategory: CommandDef<{ fold: Id; id: Id; direction: Direction; parentId: Id | null; name: string; icon?: string | null; color?: number }, Id, CategoryCommandError> = {
    name: 'createCategory',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('category_exists', 'A category with this id already exists');
      const ledger = await loadLedger(ctx, c.fold);
      const input: NewCategory = { direction: c.direction, parentId: c.parentId, name: c.name, icon: c.icon ?? null, color: c.color ?? 0 };
      const valid = validateNewCategory(input, ledger.categories);
      if (!valid.ok) return valid;
      const siblings = [...ledger.categories.values()].filter((x) => x.direction === c.direction && x.parentId === c.parentId);
      const sortOrder = maxOf(siblings.map((x) => x.sortOrder), -1) + 1;
      const fields = categoryFieldPatch({ ...valid.value, sortOrder, archived: false });
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.category, fields, sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(c.id);
    },
  };

  /** Creates the default set once per Fold. Ids are derived from the Fold id, so it is safe to run on every device. */
  const seedDefaultCategories: CommandDef<{ fold: Id }, number, never> = {
    name: 'seedDefaultCategories',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const drafts = [];
      for (const d of defaultCategories(c.fold)) {
        if ((await ctx.reader.getRecord(c.fold, d.id)) !== undefined) continue; // already there, or the user changed or deleted it
        drafts.push({
          fold: c.fold, rec: d.id, table: TABLE.category, sets: noSets,
          fields: categoryFieldPatch({ direction: d.direction, parentId: d.parentId, name: d.name, icon: d.icon, color: d.color, sortOrder: d.sortOrder, archived: false }),
        });
      }
      if (drafts.length === 0) return ok(0);
      const written = await ctx.submit(drafts);
      if (!written.ok) return written as never;
      return ok(drafts.length);
    },
  };

  const updateCategory: CommandDef<{ fold: Id; id: Id; changes: CategoryChanges }, true, CategoryCommandError> = {
    name: 'updateCategory',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const current = await loadCategory(ctx, c.fold, c.id);
      if (!current.ok) return current;
      const probe = c.changes.name === undefined ? ok({ name: current.value.name }) : validateNewCategory({ direction: current.value.direction, parentId: null, name: c.changes.name }, new Map());
      if (!probe.ok) return probe;
      const fields = categoryFieldPatch({ ...c.changes, ...(c.changes.name !== undefined && { name: probe.value.name }) });
      if (fields.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.category, fields, sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok(true as const);
    },
  };

  const moveCategory: CommandDef<{ fold: Id; id: Id; parentId: Id | null }, true, CategoryCommandError> = {
    name: 'moveCategory',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const ledger = await loadLedger(ctx, c.fold);
      const valid = validateCategoryMove(c.id, c.parentId, ledger.categories);
      if (!valid.ok) return valid;
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.category, fields: categoryFieldPatch({ parentId: c.parentId }), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /** Deletes a category nobody uses. A used one has to be merged into another so no transaction loses its category silently. */
  const deleteCategory: CommandDef<{ fold: Id; id: Id }, true, CategoryCommandError> = {
    name: 'deleteCategory',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const current = await loadCategory(ctx, c.fold, c.id);
      if (!current.ok) return current;
      const ledger = await loadLedger(ctx, c.fold);
      const used = [...ledger.transactions.values()].some((t) => t.categoryId === c.id) || [...ledger.categories.values()].some((x) => x.parentId === c.id);
      if (used) return err('category_in_use', 'Merge this category into another one first');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.category, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /** Folds `from` into `into`: everything pointing at `from` now points at `into`, then `from` is deleted (FR-050). */
  const mergeCategories: CommandDef<{ fold: Id; from: Id; into: Id }, { reassigned: number }, CategoryCommandError> = {
    name: 'mergeCategories',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if (c.from === c.into) return err('merge_into_self', 'Pick a different category to merge into');
      const from = await loadCategory(ctx, c.fold, c.from);
      if (!from.ok) return from;
      const into = await loadCategory(ctx, c.fold, c.into);
      if (!into.ok) return into;
      if (from.value.direction !== into.value.direction) return err('merge_direction_mismatch', 'Merge expense categories with expense, income with income');
      if (into.value.parentId === c.from) return err('category_cycle', 'Merge a child into its parent, not the other way round');

      const ledger = await loadLedger(ctx, c.fold);
      const children = [...ledger.categories.values()].filter((x) => x.parentId === c.from);
      if (children.length > 0 && into.value.parentId !== null) return err('category_depth', 'The children would end up three levels deep');

      const drafts = [
        ...[...ledger.transactions.values()].filter((t) => t.categoryId === c.from).map((t) => ({
          fold: c.fold, rec: t.id, table: TABLE.transaction, fields: new Map<number, FieldValue>([[TXN_FIELD.categoryId, c.into]]), sets: noSets,
        })),
        ...children.map((x) => ({ fold: c.fold, rec: x.id, table: TABLE.category, fields: categoryFieldPatch({ parentId: c.into }), sets: noSets })),
      ];
      const reassigned = drafts.length;
      drafts.push({ fold: c.fold, rec: c.from, table: TABLE.category, fields: new Map([[DELETED_FIELD, true]]), sets: noSets });
      const written = await ctx.submit(drafts);
      if (!written.ok) return written as never;
      return ok({ reassigned });
    },
  };

  return { createCategory, seedDefaultCategories, updateCategory, moveCategory, deleteCategory, mergeCategories };
}

// ---------------------------------------------------------------- payees and tags

type LabelTable = typeof TABLE.payee | typeof TABLE.tag;

export function createLabelCommands() {
  const create = (table: LabelTable, name: string): CommandDef<{ fold: Id; id: Id; name: string; color?: number }, Id, LabelCommandError> => ({
    name: table === TABLE.payee ? 'createPayee' : 'createTag',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const valid = validateLabelName(c.name);
      if (!valid.ok) return valid;
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('label_exists', `A ${name} with this id already exists`);
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table, fields: labelFieldPatch({ name: valid.value, color: c.color ?? 0 }), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(c.id);
    },
  });

  const update = (table: LabelTable): CommandDef<{ fold: Id; id: Id; name?: string; color?: number }, true, LabelCommandError> => ({
    name: table === TABLE.payee ? 'updatePayee' : 'updateTag',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const current = await loadLabel(ctx, c.fold, c.id, table);
      if (!current.ok) return current;
      let name: string | undefined;
      if (c.name !== undefined) {
        const valid = validateLabelName(c.name);
        if (!valid.ok) return valid;
        name = valid.value;
      }
      const fields = labelFieldPatch({ ...(name !== undefined && { name }), ...(c.color !== undefined && { color: c.color }) });
      if (fields.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table, fields, sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok(true as const);
    },
  });

  /** Removes a label and clears it from every transaction that used it. */
  const remove = (table: LabelTable): CommandDef<{ fold: Id; id: Id }, { cleared: number }, LabelCommandError> => ({
    name: table === TABLE.payee ? 'deletePayee' : 'deleteTag',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const current = await loadLabel(ctx, c.fold, c.id, table);
      if (!current.ok) return current;
      const ledger = await loadLedger(ctx, c.fold);
      const users = [...ledger.transactions.values()].filter((t) => (table === TABLE.payee ? t.payeeId === c.id : t.tagIds.includes(c.id)));
      const drafts = [];
      for (const t of users) {
        const state = await ctx.reader.getRecord(c.fold, t.id);
        drafts.push(table === TABLE.payee
          ? { fold: c.fold, rec: t.id, table: TABLE.transaction, fields: new Map<number, FieldValue>([[TXN_FIELD.payeeId, null]]), sets: noSets }
          : { fold: c.fold, rec: t.id, table: TABLE.transaction, fields: new Map<number, FieldValue>(), sets: new Map<number, SetDelta>([[TXN_FIELD.tagIds, setTo(state, TXN_FIELD.tagIds, t.tagIds.filter((x) => x !== c.id))]]) });
      }
      drafts.push({ fold: c.fold, rec: c.id, table, fields: new Map<number, FieldValue>([[DELETED_FIELD, true]]), sets: noSets });
      const written = await ctx.submit(drafts);
      if (!written.ok) return written as never;
      return ok({ cleared: users.length });
    },
  });

  /** Merges several labels into one. Transactions are repointed, and a tag already on the transaction is not doubled (FR-050). */
  const merge = (table: LabelTable): CommandDef<{ fold: Id; from: Id; into: Id }, { reassigned: number }, LabelCommandError> => ({
    name: table === TABLE.payee ? 'mergePayees' : 'mergeTags',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if (c.from === c.into) return err('merge_into_self', 'Pick a different one to merge into');
      const from = await loadLabel(ctx, c.fold, c.from, table);
      if (!from.ok) return from;
      const into = await loadLabel(ctx, c.fold, c.into, table);
      if (!into.ok) return into;
      const ledger = await loadLedger(ctx, c.fold);
      const users = [...ledger.transactions.values()].filter((t) => (table === TABLE.payee ? t.payeeId === c.from : t.tagIds.includes(c.from)));
      const drafts = [];
      for (const t of users) {
        const state = await ctx.reader.getRecord(c.fold, t.id);
        if (table === TABLE.payee) {
          drafts.push({ fold: c.fold, rec: t.id, table: TABLE.transaction, fields: new Map<number, FieldValue>([[TXN_FIELD.payeeId, c.into]]), sets: noSets });
        } else {
          const next = [...new Set(t.tagIds.map((x) => (x === c.from ? c.into : x)))];
          drafts.push({ fold: c.fold, rec: t.id, table: TABLE.transaction, fields: new Map<number, FieldValue>(), sets: new Map<number, SetDelta>([[TXN_FIELD.tagIds, setTo(state, TXN_FIELD.tagIds, next)]]) });
        }
      }
      drafts.push({ fold: c.fold, rec: c.from, table, fields: new Map<number, FieldValue>([[DELETED_FIELD, true]]), sets: noSets });
      const written = await ctx.submit(drafts);
      if (!written.ok) return written as never;
      return ok({ reassigned: users.length });
    },
  });

  return {
    createPayee: create(TABLE.payee, 'payee'), updatePayee: update(TABLE.payee), deletePayee: remove(TABLE.payee), mergePayees: merge(TABLE.payee),
    createTag: create(TABLE.tag, 'tag'), updateTag: update(TABLE.tag), deleteTag: remove(TABLE.tag), mergeTags: merge(TABLE.tag),
  };
}

/** How often each category, payee and tag is used. Derived on the device, never synced. */
export interface UsageCounts {
  readonly categories: ReadonlyMap<Id, number>;
  readonly payees: ReadonlyMap<Id, number>;
  readonly tags: ReadonlyMap<Id, number>;
}

export const labelUsage: QueryDef<{ fold: Id }, UsageCounts> = {
  name: 'labelUsage',
  requires: 'viewer',
  foldOf: (q) => q.fold,
  async read(q, ctx) {
    const ledger = await loadLedger(ctx, q.fold);
    const bump = (m: Map<Id, number>, k: Id): void => void m.set(k, (m.get(k) ?? 0) + 1);
    const categories = new Map<Id, number>();
    const payees = new Map<Id, number>();
    const tags = new Map<Id, number>();
    for (const t of ledger.transactions.values()) {
      if (t.categoryId !== null) bump(categories, t.categoryId);
      if (t.payeeId !== null) bump(payees, t.payeeId);
      for (const tag of t.tagIds) bump(tags, tag);
    }
    return { categories, payees, tags };
  },
};

/** Finds a label with the same name once case and accents are ignored: used to avoid creating look-alike duplicates. */
export const sameLabel = (a: string, b: string): boolean => labelKey(a) === labelKey(b);
