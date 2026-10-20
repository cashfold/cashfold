import type { Id } from '../../shared-kernel/id';
import type { CommandDef } from '../../sync/application/buses';
import type { FieldValue } from '../../sync/domain/merge';
import { transactionFieldPatch } from '../domain/transaction';
import { TABLE } from '../domain/tables';
import { secondsOf } from '../domain/util';
import type { ClockPort } from '../../sync/ports/index';
import { loadLedger, noSets } from './context';
import { snapshotBase } from './fx-snapshot';
import { money } from '../../shared-kernel/money';

export interface RevalueReport {
  readonly revalued: number;
  readonly unchanged: number;
  /** Transactions that could not be revalued because no rate is known, with the currency that is missing. */
  readonly missingRates: ReadonlyArray<{ readonly id: Id; readonly currency: string }>;
}

/**
 * Re-snapshots the base-currency equivalent of existing transactions (FR-041). Entry freezes the base amount; this is
 * the only way it changes. `asOfUtcS` picks the rates (default: now, so "current rates"; pass a transaction's own time
 * to restore the rate in force then). Transactions without a usable rate are left alone and reported.
 */
export function createRevalue({ clock }: { clock: ClockPort }) {
  const revalue: CommandDef<{ fold: Id; ids: readonly Id[]; asOfUtcS?: number }, RevalueReport, never> = {
    name: 'revalue',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const ledger = await loadLedger(ctx, c.fold);
      const base = ledger.baseCurrency;
      const asOfUtcS = c.asOfUtcS ?? secondsOf(clock.nowMs());
      const drafts = [];
      const missingRates: Array<{ id: Id; currency: string }> = [];
      let unchanged = 0;
      for (const id of c.ids) {
        const t = ledger.transactions.get(id);
        if (t === undefined || base === undefined) continue;
        const amount = money(t.amountMinor, t.currency);
        if (!amount.ok) continue;
        const next = snapshotBase({ amount: amount.value, baseCurrency: base, rates: ledger.rates, asOfUtcS });
        if (!next.ok) {
          if (next.error.code === 'rate_required') missingRates.push({ id, currency: next.error.currency });
          continue;
        }
        const same =
          next.value.baseAmountMinor === t.baseAmountMinor && next.value.baseCurrency === t.baseCurrency &&
          next.value.fxRateId === t.fxRateId && next.value.fxBaseRateId === t.fxBaseRateId;
        if (same) {
          unchanged += 1;
          continue;
        }
        // The whole amount group is rewritten together so a concurrent edit of the amount cannot be torn apart from its snapshot.
        const fields: Map<number, FieldValue> = transactionFieldPatch({
          direction: t.direction, amountMinor: t.amountMinor, currency: t.currency, ...next.value,
        });
        drafts.push({ fold: c.fold, rec: id, table: TABLE.transaction, fields, sets: noSets });
      }
      if (drafts.length > 0) {
        const written = await ctx.submit(drafts);
        if (!written.ok) return written as never;
      }
      return { ok: true, value: { revalued: drafts.length, unchanged, missingRates } };
    },
  };
  return { revalue };
}
