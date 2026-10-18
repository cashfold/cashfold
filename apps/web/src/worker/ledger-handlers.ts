import {
  createAccountCommands, createAdjustBalance, createCategoryCommands, createLabelCommands, createRateCommands, createRevalue,
  createTransactionCommands, labelUsage, newIdV4, purgeExpired, type ClockPort, type CommandDef, type DomainError, type Id,
} from '@cashfold/core';
import type { OpenSession } from '../adapters/sqlite-opfs/web-session';
import type { Handlers } from './rpc';

// The ledger's surface on the Core Worker (contracts/core-api.md, "Ledger commands and queries"). Commands go through
// the command bus (one transaction each, role checked, events published after commit); queries read the cached
// ledger view. Records the page creates get their ids here, so the page never needs a source of randomness.

export interface LedgerHandlerDeps {
  /** The open, unlocked session, or an `RpcError('locked')`. */
  readonly open: () => OpenSession;
  readonly clock: ClockPort;
  readonly rng: { bytes(n: number): Uint8Array };
}

type AnyCommand = CommandDef<never, unknown, DomainError>;

export function createLedgerHandlers({ open, clock, rng }: LedgerHandlerDeps): Handlers {
  const accounts = createAccountCommands();
  const categories = createCategoryCommands();
  const labels = createLabelCommands();
  const transactions = createTransactionCommands({ clock });
  const rates = createRateCommands();
  const { adjustBalance } = createAdjustBalance({ clock });
  const { revalue } = createRevalue({ clock });

  /** Commands whose record is new get an id from the worker unless the caller supplies one. */
  const mint = true;
  const commands: Record<string, { def: AnyCommand; mint?: boolean }> = {
    'ledger.createAccount': { def: accounts.createAccountRecord as unknown as AnyCommand, mint },
    'ledger.updateAccount': { def: accounts.updateAccount as unknown as AnyCommand },
    'ledger.archiveAccount': { def: accounts.archiveAccount as unknown as AnyCommand },
    'ledger.deleteAccount': { def: accounts.deleteLedgerAccount as unknown as AnyCommand },
    'ledger.createGroup': { def: accounts.createAccountGroup as unknown as AnyCommand, mint },
    'ledger.updateGroup': { def: accounts.updateAccountGroup as unknown as AnyCommand },
    'ledger.deleteGroup': { def: accounts.deleteAccountGroup as unknown as AnyCommand },
    'ledger.groupAccounts': { def: accounts.groupAccounts as unknown as AnyCommand },
    'ledger.createCategory': { def: categories.createCategory as unknown as AnyCommand, mint },
    'ledger.updateCategory': { def: categories.updateCategory as unknown as AnyCommand },
    'ledger.moveCategory': { def: categories.moveCategory as unknown as AnyCommand },
    'ledger.deleteCategory': { def: categories.deleteCategory as unknown as AnyCommand },
    'ledger.mergeCategories': { def: categories.mergeCategories as unknown as AnyCommand },
    'ledger.createPayee': { def: labels.createPayee as unknown as AnyCommand, mint },
    'ledger.updatePayee': { def: labels.updatePayee as unknown as AnyCommand },
    'ledger.deletePayee': { def: labels.deletePayee as unknown as AnyCommand },
    'ledger.mergePayees': { def: labels.mergePayees as unknown as AnyCommand },
    'ledger.createTag': { def: labels.createTag as unknown as AnyCommand, mint },
    'ledger.updateTag': { def: labels.updateTag as unknown as AnyCommand },
    'ledger.deleteTag': { def: labels.deleteTag as unknown as AnyCommand },
    'ledger.mergeTags': { def: labels.mergeTags as unknown as AnyCommand },
    'ledger.addTransaction': { def: transactions.addTransaction as unknown as AnyCommand, mint },
    'ledger.updateTransaction': { def: transactions.updateTransaction as unknown as AnyCommand },
    'ledger.deleteTransaction': { def: transactions.deleteTransaction as unknown as AnyCommand },
    'ledger.restoreTransaction': { def: transactions.restoreTransaction as unknown as AnyCommand },
    'ledger.adjustBalance': { def: adjustBalance as unknown as AnyCommand, mint },
    'ledger.setCustomRate': { def: rates.setCustomRate as unknown as AnyCommand, mint },
    'ledger.deleteCustomRate': { def: rates.deleteCustomRate as unknown as AnyCommand },
    'ledger.revalue': { def: revalue as unknown as AnyCommand },
  };

  const handlers: Record<string, Handlers[string]> = {};
  for (const [method, { def, mint: needsId }] of Object.entries(commands)) {
    handlers[method] = (async (args: Record<string, unknown>) => {
      const session = open();
      const command = needsId === true && args['id'] === undefined ? { ...args, id: newIdV4((n) => rng.bytes(n)) } : args;
      return session.commandBus.execute(def as CommandDef<unknown, unknown, DomainError>, command);
    }) as Handlers[string];
  }

  const query = <A extends { fold: Id }>(method: string, run: (session: OpenSession, args: A) => Promise<unknown>): void => {
    handlers[method] = (async (args: A) => run(open(), args)) as unknown as Handlers[string];
  };
  const via = (pick: (s: OpenSession) => unknown) => (session: OpenSession, args: { fold: Id }) =>
    session.queryBus.execute(pick(session) as never, args as never);

  query('ledger.basics', async (session, args: { fold: Id }) => {
    const result = await session.queryBus.execute(session.queries.ledgerBasics, args);
    return result.ok ? { ok: true, value: { ...result.value, thisDevice: session.deviceId } } : result;
  });
  query('ledger.accountBalance', via((s) => s.queries.accountBalance));
  query('ledger.transactions', via((s) => s.queries.listTransactions));
  query('ledger.netWorth', via((s) => s.queries.netWorth));
  query('ledger.spendingByCategory', via((s) => s.queries.spendingByCategory));
  query('ledger.incomeVsExpense', via((s) => s.queries.incomeVsExpense));
  query('ledger.dayEndBalances', via((s) => s.queries.dayEndBalances));
  query('ledger.dashboard', via((s) => s.queries.dashboard));
  query('ledger.recentlyDeleted', via((s) => s.queries.recentlyDeleted));
  query('ledger.needsAttention', via((s) => s.queries.needsAttention));
  query('ledger.accountDeletion', via(() => accounts.describeAccountDeletion));
  query('ledger.usage', via(() => labelUsage));

  /** Runs the retention job now (it also runs when a session starts). */
  query('ledger.purge', async (session, args: { fold: Id }) => purgeExpired({ oplog: session.oplog, projections: session.projections }, args.fold, clock.nowMs()));

  return handlers;
}
