import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { CommandContext, QueryContext } from '../../sync/application/buses';
import type { ClockPort } from '../../sync/ports/index';
import { isVisible, type RecordState } from '../../sync/domain/merge';
import { buildLedger, type Ledger } from './projections/ledger';
import { decodeAccount, decodeCategory, decodeLabel, type Category } from '../domain/records';
import type { Account } from '../domain/account';
import type { Label } from '../domain/label';
import { TABLE } from '../domain/tables';

/** What the ledger commands need beyond the write path. */
export interface LedgerDeps {
  readonly clock: ClockPort;
}

type Reading = Pick<CommandContext | QueryContext, 'reader'>;

/** The whole ledger of a Fold, projected from its records. Used where a rule needs the whole picture. */
export async function loadLedger(ctx: Reading, fold: Id): Promise<Ledger> {
  return buildLedger(await ctx.reader.listRecords(fold));
}

async function visible(ctx: Reading, fold: Id, rec: Id, table: number): Promise<RecordState | undefined> {
  const state = await ctx.reader.getRecord(fold, rec);
  return state !== undefined && state.table === table && isVisible(state) ? state : undefined;
}

export type NotFound = DomainError<'not_found'>;
const notFound = (what: string): Result<never, NotFound> => err('not_found', `That ${what} does not exist`);

export async function loadAccount(ctx: Reading, fold: Id, rec: Id): Promise<Result<Account, NotFound>> {
  const state = await visible(ctx, fold, rec, TABLE.account);
  const account = state === undefined ? undefined : decodeAccount(rec, state);
  return account === undefined ? notFound('account') : ok(account);
}

export async function loadCategory(ctx: Reading, fold: Id, rec: Id): Promise<Result<Category, NotFound>> {
  const state = await visible(ctx, fold, rec, TABLE.category);
  const category = state === undefined ? undefined : decodeCategory(rec, state);
  return category === undefined ? notFound('category') : ok(category);
}

export async function loadLabel(ctx: Reading, fold: Id, rec: Id, table: typeof TABLE.payee | typeof TABLE.tag): Promise<Result<Label, NotFound>> {
  const state = await visible(ctx, fold, rec, table);
  const label = state === undefined ? undefined : decodeLabel(rec, state, table);
  return label === undefined ? notFound(table === TABLE.payee ? 'payee' : 'tag') : ok(label);
}

export const noSets = new Map<number, never>();
