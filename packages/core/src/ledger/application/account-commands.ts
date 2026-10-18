import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef, QueryDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible, type FieldValue } from '../../sync/domain/merge';
import {
  accountFieldPatch, cleanName, validateAccountUpdate, validateNewAccount,
  type Account, type AccountChanges, type AccountError, type NewAccount, type NewAccountInput,
} from '../domain/account';
import { GROUP_FIELD, ACCOUNT_FIELD, TABLE, TRANSFER_FIELD, TXN_FIELD } from '../domain/tables';
import { addMembers, removeMembers } from '../domain/sets';
import { maxOf } from '../domain/util';
import { loadAccount, loadLedger, noSets, type NotFound } from './context';

export type AccountExists = DomainError<'account_exists'>;
export type OpeningDateError = DomainError<'opening_date_after_entries'>;
export type GroupError = DomainError<'invalid_group_name' | 'group_exists' | 'unknown_group'>;
export type ConfirmationRequired = DomainError<'confirmation_required'>;

const MAX_GROUP_NAME = 80;

/** The fields of `next` that differ from `current`: only changes are written, so concurrent edits to other fields survive. */
function changedOnly(current: NewAccount, next: NewAccount): Partial<NewAccount> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof NewAccount>) {
    if (current[key] !== next[key]) out[key] = next[key];
  }
  return out as Partial<NewAccount>;
}

export function createAccountCommands() {
  const createAccountRecord: CommandDef<{ fold: Id; id: Id } & NewAccountInput, Account, AccountError | AccountExists> = {
    name: 'createAccountRecord',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('account_exists', 'An account with this id already exists');
      const { fold, id, ...input } = c;
      let sortOrder = input.sortOrder;
      if (sortOrder === undefined) {
        const ledger = await loadLedger(ctx, fold);
        sortOrder = maxOf([...ledger.accounts.values()].map((a) => a.sortOrder), -1) + 1;
      }
      const valid = validateNewAccount({ ...input, sortOrder });
      if (!valid.ok) return valid;
      const written = await ctx.submit([{ fold, rec: id, table: TABLE.account, fields: accountFieldPatch(valid.value), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok({ ...valid.value, id, groupIds: [] });
    },
  };

  const updateAccount: CommandDef<{ fold: Id; id: Id; changes: AccountChanges }, Account, AccountError | NotFound | OpeningDateError> = {
    name: 'updateAccount',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const current = await loadAccount(ctx, c.fold, c.id);
      if (!current.ok) return current;
      const ledger = await loadLedger(ctx, c.fold);
      const own = [...ledger.transactions.values(), ...[...ledger.deleted.values()].map((d) => d.transaction)].filter((t) => t.accountId === c.id);
      const valid = validateAccountUpdate(current.value, c.changes, { hasEntries: own.length > 0 });
      if (!valid.ok) return valid;
      if (c.changes.openingDate !== undefined && own.some((t) => t.localDate < valid.value.openingDate)) {
        return err('opening_date_after_entries', 'The opening date cannot be later than existing entries');
      }
      const changed = changedOnly(current.value, valid.value);
      if (Object.keys(changed).length > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.account, fields: accountFieldPatch(changed), sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok({ ...current.value, ...valid.value });
    },
  };

  const archiveAccount: CommandDef<{ fold: Id; id: Id; archived: boolean }, boolean, NotFound> = {
    name: 'archiveAccount',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const current = await loadAccount(ctx, c.fold, c.id);
      if (!current.ok) return current;
      if (current.value.archived !== c.archived) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.account, fields: accountFieldPatch({ archived: c.archived }), sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok(c.archived);
    },
  };

  // ---- groups

  const createAccountGroup: CommandDef<{ fold: Id; id: Id; name: string; icon?: string | null; color?: number }, Id, GroupError> = {
    name: 'createAccountGroup',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const name = cleanName(c.name, MAX_GROUP_NAME);
      if (name === undefined) return err('invalid_group_name', 'A group name has 1 to 80 characters');
      if ((await ctx.reader.getRecord(c.fold, c.id)) !== undefined) return err('group_exists', 'A group with this id already exists');
      const ledger = await loadLedger(ctx, c.fold);
      const fields = new Map<number, FieldValue>([
        [GROUP_FIELD.name, name], [GROUP_FIELD.icon, c.icon ?? null], [GROUP_FIELD.color, BigInt(c.color ?? 0)],
        [GROUP_FIELD.sortOrder, BigInt(maxOf([...ledger.groups.values()].map((g) => g.sortOrder), -1) + 1)],
      ]);
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.accountGroup, fields, sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(c.id);
    },
  };

  const updateAccountGroup: CommandDef<{ fold: Id; id: Id; name?: string; icon?: string | null; color?: number; sortOrder?: number }, true, GroupError> = {
    name: 'updateAccountGroup',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.accountGroup || !isVisible(state)) return err('unknown_group', 'That group does not exist');
      const fields = new Map<number, FieldValue>();
      if (c.name !== undefined) {
        const name = cleanName(c.name, MAX_GROUP_NAME);
        if (name === undefined) return err('invalid_group_name', 'A group name has 1 to 80 characters');
        fields.set(GROUP_FIELD.name, name);
      }
      if (c.icon !== undefined) fields.set(GROUP_FIELD.icon, c.icon);
      if (c.color !== undefined) fields.set(GROUP_FIELD.color, BigInt(c.color));
      if (c.sortOrder !== undefined) fields.set(GROUP_FIELD.sortOrder, BigInt(c.sortOrder));
      if (fields.size > 0) {
        const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.accountGroup, fields, sets: noSets }]);
        if (!written.ok) return written as never;
      }
      return ok(true as const);
    },
  };

  /** Deleting a group only ungroups: the accounts themselves are untouched. */
  const deleteAccountGroup: CommandDef<{ fold: Id; id: Id }, true, GroupError> = {
    name: 'deleteAccountGroup',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      if (state === undefined || state.table !== TABLE.accountGroup || !isVisible(state)) return err('unknown_group', 'That group does not exist');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.accountGroup, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /** Adds accounts to a group, or takes them out. */
  const groupAccounts: CommandDef<{ fold: Id; group: Id; accounts: readonly Id[]; member: boolean }, true, GroupError | NotFound> = {
    name: 'groupAccounts',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const group = await ctx.reader.getRecord(c.fold, c.group);
      if (c.member && (group === undefined || group.table !== TABLE.accountGroup || !isVisible(group))) return err('unknown_group', 'That group does not exist');
      const drafts = [];
      for (const id of c.accounts) {
        const state = await ctx.reader.getRecord(c.fold, id);
        if (state === undefined || state.table !== TABLE.account || !isVisible(state)) return err('not_found', 'That account does not exist');
        const delta = c.member ? addMembers([c.group]) : removeMembers(state, ACCOUNT_FIELD.groupIds, [c.group]);
        drafts.push({ fold: c.fold, rec: id, table: TABLE.account, fields: new Map<number, FieldValue>(), sets: new Map([[ACCOUNT_FIELD.groupIds, delta]]) });
      }
      if (drafts.length > 0) {
        const written = await ctx.submit(drafts);
        if (!written.ok) return written as never;
      }
      return ok(true as const);
    },
  };

  // ---- deletion

  const deleteLedgerAccount: CommandDef<{ fold: Id; id: Id; confirm: boolean }, DeletionSummary, NotFound | ConfirmationRequired> = {
    name: 'deleteLedgerAccount',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if (!c.confirm) return err('confirmation_required', 'Deleting an account removes its transactions and transfers; confirm to continue');
      const account = await loadAccount(ctx, c.fold, c.id);
      if (!account.ok) return account;
      const dependants = await dependantsOf(ctx, c.fold, c.id);
      const tombstone = new Map<number, FieldValue>([[DELETED_FIELD, true]]);
      // The account and everything that cannot exist without it go in one atomic step.
      const drafts = [
        { fold: c.fold, rec: c.id, table: TABLE.account, fields: tombstone, sets: noSets },
        ...dependants.map((d) => ({ fold: c.fold, rec: d.rec, table: d.table, fields: tombstone, sets: noSets })),
      ];
      const written = await ctx.submit(drafts);
      if (!written.ok) return written as never;
      return ok(summarise(account.value.name, dependants));
    },
  };

  const describeAccountDeletion: QueryDef<{ fold: Id; id: Id }, DeletionSummary | undefined> = {
    name: 'describeAccountDeletion',
    requires: 'viewer',
    foldOf: (q) => q.fold,
    async read(q, ctx) {
      const account = await loadAccount(ctx, q.fold, q.id);
      return account.ok ? summarise(account.value.name, await dependantsOf(ctx, q.fold, q.id)) : undefined;
    },
  };

  return { createAccountRecord, updateAccount, archiveAccount, createAccountGroup, updateAccountGroup, deleteAccountGroup, groupAccounts, deleteLedgerAccount, describeAccountDeletion };
}

/** What deleting an account removes, for the warning that precedes it (FR-027). */
export interface DeletionSummary {
  readonly accountName: string;
  readonly transactions: number;
  readonly transfers: number;
}

interface Dependant {
  readonly rec: Id;
  readonly table: number;
}

async function dependantsOf(ctx: Parameters<typeof loadLedger>[0], fold: Id, account: Id): Promise<Dependant[]> {
  const out: Dependant[] = [];
  for (const [rec, state] of await ctx.reader.listRecords(fold)) {
    if (!isVisible(state)) continue;
    const value = (field: number): unknown => state.fields.get(field)?.value;
    if (state.table === TABLE.transaction && value(TXN_FIELD.accountId) === account) out.push({ rec, table: state.table });
    else if (state.table === TABLE.transfer && (value(TRANSFER_FIELD.fromAccountId) === account || value(TRANSFER_FIELD.toAccountId) === account)) {
      out.push({ rec, table: state.table });
    }
  }
  return out.sort((a, b) => (a.rec < b.rec ? -1 : 1));
}

const summarise = (accountName: string, dependants: readonly Dependant[]): DeletionSummary => ({
  accountName,
  transactions: dependants.filter((d) => d.table === TABLE.transaction).length,
  transfers: dependants.filter((d) => d.table === TABLE.transfer).length,
});
