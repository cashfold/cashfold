import {
  createAccountCommands, createAdjustBalance, createBudgetCommands, createBudgetQueries, createGoalCommands, createGoalQueries, createMaterialiser, createScheduleCommands, createScheduleQueries, createTransferCommands, createCategoryCommands, createLabelCommands, createRateCommands, createRevalue,
  createImportCommands, createTransactionCommands, importBatches, labelUsage, newIdV4, parseCsv, previewImport, purgeExpired, type ImportOptions, type ClockPort, type CommandDef, type DomainError, type Id,
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

/** Minutes east of UTC for this device right now. */
const deviceOffsetMin = (): number => -new Date().getTimezoneOffset();

export function createLedgerHandlers({ open, clock, rng }: LedgerHandlerDeps): Handlers {
  const accounts = createAccountCommands();
  const categories = createCategoryCommands();
  const labels = createLabelCommands();
  const transactions = createTransactionCommands({ clock });
  const rates = createRateCommands();
  const moves = createTransferCommands({ clock });
  const { adjustBalance } = createAdjustBalance({ clock });
  const { revalue } = createRevalue({ clock });
  const budgets = createBudgetCommands();
  const goals = createGoalCommands();
  const schedules = createScheduleCommands({ clock });
  const materialiser = createMaterialiser({ clock });
  const imports = createImportCommands({ clock });

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
    'ledger.addTransfer': { def: moves.addTransfer as unknown as AnyCommand, mint },
    'ledger.updateTransfer': { def: moves.updateTransfer as unknown as AnyCommand },
    'ledger.deleteTransfer': { def: moves.deleteTransfer as unknown as AnyCommand },
    'ledger.restoreTransfer': { def: moves.restoreTransfer as unknown as AnyCommand },
    'ledger.adjustBalance': { def: adjustBalance as unknown as AnyCommand, mint },
    'ledger.setCustomRate': { def: rates.setCustomRate as unknown as AnyCommand, mint },
    'ledger.deleteCustomRate': { def: rates.deleteCustomRate as unknown as AnyCommand },
    'ledger.revalue': { def: revalue as unknown as AnyCommand },
    'budgets.create': { def: budgets.createBudget as unknown as AnyCommand, mint },
    'budgets.update': { def: budgets.updateBudget as unknown as AnyCommand },
    'budgets.delete': { def: budgets.deleteBudget as unknown as AnyCommand },
    'goals.create': { def: goals.addGoal as unknown as AnyCommand, mint },
    'goals.update': { def: goals.updateGoal as unknown as AnyCommand },
    'goals.delete': { def: goals.deleteGoal as unknown as AnyCommand },
    'schedules.create': { def: schedules.createSchedule as unknown as AnyCommand, mint },
    'schedules.update': { def: schedules.updateSchedule as unknown as AnyCommand },
    'schedules.finish': { def: schedules.finishSchedule as unknown as AnyCommand },
    'schedules.delete': { def: schedules.deleteSchedule as unknown as AnyCommand },
    'schedules.confirm': { def: materialiser.confirmOccurrence as unknown as AnyCommand },
    'schedules.skip': { def: materialiser.skipOccurrence as unknown as AnyCommand },
    'schedules.materialise': { def: materialiser.materialiseDue as unknown as AnyCommand },
  };

  const handlers: Record<string, Handlers[string]> = {};
  for (const [method, { def, mint: needsId }] of Object.entries(commands)) {
    handlers[method] = (async (args: Record<string, unknown>) => {
      const session = open();
      const command = needsId === true && args['id'] === undefined ? { ...args, id: newIdV4((n) => rng.bytes(n)) } : args;
      // Dates are the device's own: a schedule falls due on the day the person's calendar says.
      const dated = method.startsWith('schedules.') && args['tzOffsetMin'] === undefined ? { ...command, tzOffsetMin: deviceOffsetMin() } : command;
      const result = await session.commandBus.execute(def as CommandDef<unknown, unknown, DomainError>, dated);
      // A schedule that is already due when it is created or edited makes its occurrences at once, not at the next visit.
      if (result.ok && (method === 'schedules.create' || method === 'schedules.update')) {
        await session.commandBus.execute(materialiser.materialiseDue as unknown as CommandDef<unknown, unknown, DomainError>, { fold: args['fold'], tzOffsetMin: deviceOffsetMin() }).catch(() => undefined);
      }
      return result;
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
  query('ledger.transfers', via((s) => s.queries.listTransfers));
  query('ledger.recentlyDeletedTransfers', via((s) => s.queries.recentlyDeletedTransfers));
  query('ledger.netWorth', via((s) => s.queries.netWorth));
  query('ledger.spendingByCategory', via((s) => s.queries.spendingByCategory));
  query('ledger.incomeVsExpense', via((s) => s.queries.incomeVsExpense));
  query('ledger.dayEndBalances', via((s) => s.queries.dayEndBalances));
  query('ledger.dashboard', via((s) => s.queries.dashboard));
  query('ledger.recentlyDeleted', via((s) => s.queries.recentlyDeleted));
  query('ledger.needsAttention', via((s) => s.queries.needsAttention));
  query('ledger.accountDeletion', via(() => accounts.describeAccountDeletion));
  query('ledger.usage', via(() => labelUsage));

  // Budgets are derived from the ledger view and the Fold's records; the periods are never stored.
  query('budgets.list', async (session, args: { fold: Id; on?: number }) => {
    const queries = createBudgetQueries({ views: session.views, clock });
    return session.queryBus.execute(queries.listBudgets as never, args as never);
  });
  query('budgets.detail', async (session, args: { fold: Id; id: Id; index?: number }) => {
    const queries = createBudgetQueries({ views: session.views, clock });
    return session.queryBus.execute(queries.budgetDetail as never, args as never);
  });

  query('goals.progress', async (session, args: { fold: Id }) => {
    const queries = createGoalQueries({ views: session.views, clock });
    return session.queryBus.execute(queries.goalProgress as never, { tzOffsetMin: deviceOffsetMin(), ...args } as never);
  });

  const scheduleQueries = (session: OpenSession) => createScheduleQueries({ views: session.views, clock });
  const scheduleQuery = <A extends { fold: Id }>(method: string, pick: (q: ReturnType<typeof createScheduleQueries>) => unknown): void =>
    query(method, async (session, args: A) => session.queryBus.execute(pick(scheduleQueries(session)) as never, { tzOffsetMin: deviceOffsetMin(), ...args } as never));
  scheduleQuery('schedules.list', (q) => q.listSchedules);
  scheduleQuery('schedules.upcoming', (q) => q.upcoming);
  scheduleQuery('schedules.pending', (q) => q.pendingConfirmations);
  scheduleQuery('schedules.projectedBalance', (q) => q.projectedBalance);
  scheduleQuery('schedules.reminders', (q) => q.reminders);

  /** Re-snapshots every transaction that is not in the Fold's base currency, with the rates known now (FR-041). */
  query('ledger.revalueAll', async (session, args: { fold: Id; asOfUtcS?: number }) => {
    const view = await session.views.get(args.fold, session.projections);
    const base = view.ledger.baseCurrency;
    const ids = [...view.ledger.transactions.values()].filter((t) => t.currency !== base).map((t) => t.id);
    return session.commandBus.execute(revalue as unknown as CommandDef<{ fold: Id; ids: Id[]; asOfUtcS?: number }, unknown, DomainError>, { fold: args.fold, ids, ...(args.asOfUtcS !== undefined && { asOfUtcS: args.asOfUtcS }) });
  });

  // CSV import (FR-090): read the file, look at what would come in, import it as one batch, take a batch back.
  const PREVIEW_ROWS = 200;
  query('csv.preview', async (session, args: { fold: Id; text: string; delimiter?: ',' | ';' | '\t'; options?: ImportOptions }) => {
    const parsed = parseCsv(args.text, args.delimiter);
    const header = parsed.rows[0] ?? [];
    if (args.options === undefined) return { ok: true, value: { delimiter: parsed.delimiter, rows: parsed.rows.length, header, sample: parsed.rows.slice(0, 6) } };
    const view = await session.views.get(args.fold, session.projections);
    const p = previewImport(view.ledger, parsed.rows, args.options);
    // Rows with a problem come first: they are what needs attention, and the page cannot show 20,000 rows.
    const shown = [...p.rows.filter((r) => r.problem !== undefined), ...p.rows.filter((r) => r.problem === undefined)].slice(0, PREVIEW_ROWS);
    return { ok: true, value: { delimiter: parsed.delimiter, rows: parsed.rows.length, ok: p.ok, problems: p.problems, duplicates: p.duplicates, shown } };
  });
  handlers['csv.import'] = (async (args: { fold: Id; text: string; delimiter?: ',' | ';' | '\t'; source: string; options: ImportOptions; includeDuplicates?: boolean }) => {
    const session = open();
    const parsed = parseCsv(args.text, args.delimiter);
    return session.commandBus.execute(imports.importCsv as unknown as CommandDef<unknown, unknown, DomainError>, {
      fold: args.fold, batch: newIdV4((n) => rng.bytes(n)), source: args.source, table: parsed.rows, options: args.options, ...(args.includeDuplicates === true && { includeDuplicates: true }),
    });
  }) as Handlers[string];
  handlers['csv.undo'] = (async (args: { fold: Id; batch: Id }) => open().commandBus.execute(imports.undoImport as unknown as CommandDef<unknown, unknown, DomainError>, args)) as Handlers[string];
  query('csv.batches', async (session, args: { fold: Id }) => ({ ok: true, value: importBatches(await session.projections.listRecords(args.fold)) }));

  /** Runs the retention job now (it also runs when a session starts). */
  query('ledger.purge', async (session, args: { fold: Id }) => purgeExpired({ oplog: session.oplog, projections: session.projections }, args.fold, clock.nowMs()));

  return handlers;
}
