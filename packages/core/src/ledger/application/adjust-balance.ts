import type { Id } from '../../shared-kernel/id';
import { daysBetween, type LocalDate } from '../../shared-kernel/local-date';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef } from '../../sync/application/buses';
import { adjustmentFor, type BalanceError } from './balance';
import { loadLedger, loadAccount, type NotFound } from './context';
import { createTransactionCommands, type TransactionCommandError } from './transaction-commands';
import type { ClockPort } from '../../sync/ports/index';

const EPOCH_DAY = 19_700_101 as LocalDate;
const MS_PER_DAY = 86_400_000;
const NOON_MS = 12 * 60 * 60 * 1000;

/** A UTC instant that falls on `date` in the zone `tzOffsetMin` (noon, so no zone shifts it to another day). */
export const noonOf = (date: LocalDate, tzOffsetMin: number): number => daysBetween(EPOCH_DAY, date) * MS_PER_DAY + NOON_MS - tzOffsetMin * 60_000;

export type AdjustError = TransactionCommandError | BalanceError | DomainError<'no_adjustment_needed'> | NotFound;

/**
 * Sets an account's balance on a date to `target` by booking one exact-difference entry marked as an adjustment
 * (FR-034). The balance stays derived: the adjustment is an ordinary entry, never an edited balance.
 */
export function createAdjustBalance({ clock }: { clock: ClockPort }) {
  const { addTransaction } = createTransactionCommands({ clock });
  const adjustBalance: CommandDef<
    { fold: Id; id: Id; accountId: Id; target: bigint; date: LocalDate; tzOffsetMin?: number; note?: string },
    { amountMinor: bigint },
    AdjustError
  > = {
    name: 'adjustBalance',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const account = await loadAccount(ctx, c.fold, c.accountId);
      if (!account.ok) return account;
      const ledger = await loadLedger(ctx, c.fold);
      const delta = adjustmentFor(ledger, c.accountId, c.date, c.target);
      if (!delta.ok) return delta;
      if (delta.value === 0n) return err('no_adjustment_needed', 'The balance already equals that amount');
      const tz = c.tzOffsetMin ?? 0;
      const added = await addTransaction.handle(
        {
          fold: c.fold, id: c.id, accountId: c.accountId, direction: 'adjustment', amountMinor: delta.value, currency: account.value.currency,
          occurredUtcMs: noonOf(c.date, tz), tzOffsetMin: tz, note: c.note ?? '',
        },
        ctx,
      );
      return added.ok ? ok({ amountMinor: delta.value }) : added;
    },
  };
  return { adjustBalance };
}
