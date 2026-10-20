import type { Id } from '../../shared-kernel/id';
import { dayOf, fromEpochMs, monthOf, yearOf, type LocalDate } from '../../shared-kernel/local-date';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandContext, CommandDef } from '../../sync/application/buses';
import { isVisible } from '../../sync/domain/merge';
import type { ClockPort } from '../../sync/ports/index';
import { loadAccount } from '../../ledger/application/context';
import { createTransactionCommands } from '../../ledger/application/transaction-commands';
import { createTransferCommands } from '../../ledger/application/transfer-commands';
import { decodeTransaction, decodeTransfer } from '../../ledger/domain/records';
import { TABLE } from '../../ledger/domain/tables';
import type { TxnStatus } from '../../ledger/domain/transaction';
import { occurrence, occurrenceId, occurrencesUntil } from '../domain/occurrence';
import { decodeSchedule, type Schedule } from '../domain/schedule';

// The materialiser turns due occurrences into ordinary transactions and transfers. It is idempotent and convergent
// (FR-064): the record id of occurrence n is UUIDv5(schedule_id, n), so a second device creating the same occurrence
// writes the same record and the two merge into one. It is safe to run on every foreground and after every sync.
//
// Known limit: two devices that create the same occurrence write identical fields, but their clocks differ. If one of
// them is then edited by the person before the other's creation reaches it, the later clock wins field by field.
// Fields converge either way and nothing is duplicated; the person can edit again.

export interface MaterialiseFailure {
  readonly scheduleId: Id;
  readonly n: number;
  readonly code: string;
}

export interface MaterialiseReport {
  readonly created: number;
  /** Occurrences that could not be created (an account was deleted or archived, say). They are tried again next time. */
  readonly failed: readonly MaterialiseFailure[];
}

export type OccurrenceError = DomainError<'not_found' | 'invalid_occurrence' | 'not_pending'>;

/** Noon UTC of a civil date with offset 0: the same instant, and the same local date, on every device. */
const momentOf = (date: LocalDate): number => Date.UTC(yearOf(date), monthOf(date) - 1, dayOf(date), 12);

type Doer = Pick<CommandContext, 'reader' | 'submit'>;

export function createMaterialiser({ clock }: { clock: ClockPort }) {
  const transactions = createTransactionCommands({ clock });
  const transfers = createTransferCommands({ clock });

  async function create(fold: Id, s: Schedule, n: number, status: TxnStatus, ctx: Doer): Promise<string | undefined> {
    const rec = occurrenceId(s.id, n);
    const date = occurrence({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, n);
    const occurredUtcMs = momentOf(date);
    const t = s.template;
    const account = t.kind === 'transaction' ? await loadAccount(ctx, fold, t.accountId) : undefined;
    if (account !== undefined && !account.ok) return account.error.code;
    const result = t.kind === 'transaction'
      ? await transactions.addTransaction.handle({
        fold, id: rec, accountId: t.accountId, direction: t.direction, amountMinor: t.amountMinor, currency: account?.ok === true ? account.value.currency : '',
        occurredUtcMs, tzOffsetMin: 0, categoryId: t.categoryId, payeeId: t.payeeId, tagIds: t.tagIds, note: t.note, status, origin: { scheduleId: s.id, n },
      }, ctx as CommandContext)
      : await transfers.addTransfer.handle({
        fold, id: rec, fromAccountId: t.fromAccountId, toAccountId: t.toAccountId, fromAmountMinor: t.fromAmountMinor, toAmountMinor: t.toAmountMinor,
        occurredUtcMs, tzOffsetMin: 0, note: t.note, status,
      }, ctx as CommandContext);
    return result.ok ? undefined : result.error.code;
  }

  const materialiseDue: CommandDef<{ fold: Id; tzOffsetMin?: number }, MaterialiseReport, never> = {
    name: 'materialiseDue',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const today = fromEpochMs(clock.nowMs(), c.tzOffsetMin ?? 0);
      const records = await ctx.reader.listRecords(c.fold);
      const failed: MaterialiseFailure[] = [];
      let created = 0;
      for (const [rec, state] of records) {
        if (state.table !== TABLE.schedule || !isVisible(state)) continue;
        const s = decodeSchedule(rec, state);
        if (s === undefined || s.completedUtcMs !== null) continue;
        for (const n of occurrencesUntil({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, today, s.endLocalDate)) {
          if (records.has(occurrenceId(s.id, n))) continue; // made already, by this device or another, possibly deleted since
          const code = await create(c.fold, s, n, s.requiresConfirmation ? 'pending' : 'posted', ctx);
          if (code === undefined) created += 1;
          else failed.push({ scheduleId: s.id, n, code });
        }
      }
      return ok({ created, failed });
    },
  };

  async function load(ctx: Doer, fold: Id, scheduleId: Id): Promise<Schedule | undefined> {
    const state = await ctx.reader.getRecord(fold, scheduleId);
    return state !== undefined && state.table === TABLE.schedule && isVisible(state) ? decodeSchedule(scheduleId, state) : undefined;
  }

  const setStatus = async (fold: Id, s: Schedule, n: number, status: TxnStatus, ctx: Doer) => {
    const rec = occurrenceId(s.id, n);
    const state = await ctx.reader.getRecord(fold, rec);
    if (state === undefined || !isVisible(state)) return undefined;
    if (state.table === TABLE.transaction && decodeTransaction(rec, state) !== undefined) {
      return transactions.updateTransaction.handle({ fold, id: rec, changes: { status } }, ctx as CommandContext);
    }
    if (state.table === TABLE.transfer && decodeTransfer(rec, state) !== undefined) {
      return transfers.updateTransfer.handle({ fold, id: rec, changes: { status } }, ctx as CommandContext);
    }
    return undefined;
  };

  /** Confirms a pending occurrence: it becomes posted and counts in balances. */
  const confirmOccurrence: CommandDef<{ fold: Id; schedule: Id; n: number }, true, OccurrenceError | DomainError<string>> = {
    name: 'confirmOccurrence',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const s = await load(ctx, c.fold, c.schedule);
      if (s === undefined) return err('not_found', 'That schedule does not exist');
      const rec = await ctx.reader.getRecord(c.fold, occurrenceId(c.schedule, c.n));
      if (rec === undefined) return err('not_found', 'That occurrence has not been created yet');
      const result = await setStatus(c.fold, s, c.n, 'posted', ctx);
      if (result === undefined) return err('not_found', 'That occurrence no longer exists');
      return result.ok ? ok(true as const) : (result as never);
    },
  };

  /** Skips an occurrence: it is kept as a void record, so it is never created again and never counted. */
  const skipOccurrence: CommandDef<{ fold: Id; schedule: Id; n: number }, true, OccurrenceError | DomainError<string>> = {
    name: 'skipOccurrence',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const s = await load(ctx, c.fold, c.schedule);
      if (s === undefined) return err('not_found', 'That schedule does not exist');
      if (!Number.isInteger(c.n) || c.n < 0 || occurrence({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, c.n) < s.beginLocalDate) {
        return err('invalid_occurrence', 'That is not an occurrence of this schedule');
      }
      if (s.endLocalDate !== null && occurrence({ begin: s.beginLocalDate, unit: s.unit, interval: s.interval }, c.n) > s.endLocalDate) {
        return err('invalid_occurrence', 'That is after the end of this schedule');
      }
      if ((await ctx.reader.getRecord(c.fold, occurrenceId(c.schedule, c.n))) === undefined) {
        const code = await create(c.fold, s, c.n, 'void', ctx);
        return code === undefined ? ok(true as const) : err(code, 'That occurrence could not be skipped');
      }
      const result = await setStatus(c.fold, s, c.n, 'void', ctx);
      if (result === undefined) return err('not_found', 'That occurrence no longer exists');
      return result.ok ? ok(true as const) : (result as never);
    },
  };

  return { materialiseDue, confirmOccurrence, skipOccurrence };
}
