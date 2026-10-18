import { uuidV5, type Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, isVisible } from '../../sync/domain/merge';
import { exchangeRateFieldPatch, rateKey, validateExchangeRate, type ExchangeRateError } from '../domain/exchange-rate';
import { decodeExchangeRate } from '../domain/records';
import { RATE_FIELD, TABLE } from '../domain/tables';
import { loadLedger, noSets, type NotFound } from './context';

export type RateCommandError = ExchangeRateError | NotFound | DomainError<'not_custom'>;

/** The id of a service rate: derived, so every device that refreshes the same table writes the same records. */
export const serviceRateId = (fold: Id, quote: string, asOfUtcS: number): Id => uuidV5(fold, `rate.${quote}.${asOfUtcS}`);

export function createRateCommands() {
  /** The user's own rate for a currency at a time. A custom rate beats a service rate for the same instant. */
  const setCustomRate: CommandDef<{ fold: Id; id: Id; quote: string; asOfUtcS: number; rateE12: bigint }, Id, RateCommandError> = {
    name: 'setCustomRate',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const valid = validateExchangeRate({ quote: c.quote, asOfUtcS: c.asOfUtcS, rateE12: c.rateE12, source: 'custom' });
      if (!valid.ok) return valid;
      const ledger = await loadLedger(ctx, c.fold);
      const key = rateKey(valid.value.quote, valid.value.asOfUtcS);
      // The same quote and time again updates the user's own rate rather than adding a second one.
      const existing = ledger.rates.find((r) => rateKey(r.quote, r.asOfUtcS) === key && r.source === 'custom');
      const rec = existing?.id ?? c.id;
      const fields = existing === undefined ? exchangeRateFieldPatch(valid.value) : new Map([[RATE_FIELD.rateE12, valid.value.rateE12]]);
      const written = await ctx.submit([{ fold: c.fold, rec, table: TABLE.exchangeRate, fields, sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(rec);
    },
  };

  const deleteCustomRate: CommandDef<{ fold: Id; id: Id }, true, RateCommandError> = {
    name: 'deleteCustomRate',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.id);
      const rate = state !== undefined && isVisible(state) ? decodeExchangeRate(c.id, state) : undefined;
      if (rate === undefined) return err('not_found', 'That rate does not exist');
      if (rate.source !== 'custom') return err('not_custom', 'Only your own rates can be deleted');
      const written = await ctx.submit([{ fold: c.fold, rec: c.id, table: TABLE.exchangeRate, fields: new Map([[DELETED_FIELD, true]]), sets: noSets }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /**
   * Stores a published rate table (quote -> rate per USD) as service rates. Re-applying the same table is a no-op.
   * The table itself is fetched from the user's Cashfold service, never from a third party (FR-103).
   */
  const applyRateTable: CommandDef<{ fold: Id; asOfUtcS: number; rates: ReadonlyArray<{ quote: string; rateE12: bigint }> }, { stored: number; skipped: number }, RateCommandError> = {
    name: 'applyRateTable',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const drafts = [];
      let skipped = 0;
      for (const r of c.rates) {
        const valid = validateExchangeRate({ quote: r.quote, asOfUtcS: c.asOfUtcS, rateE12: r.rateE12, source: 'service' });
        if (!valid.ok) {
          skipped += 1; // one bad row in a published table must not discard the rest
          continue;
        }
        const rec = serviceRateId(c.fold, valid.value.quote, valid.value.asOfUtcS);
        if ((await ctx.reader.getRecord(c.fold, rec)) !== undefined) {
          skipped += 1;
          continue;
        }
        drafts.push({ fold: c.fold, rec, table: TABLE.exchangeRate, fields: exchangeRateFieldPatch(valid.value), sets: noSets });
      }
      if (drafts.length > 0) {
        const written = await ctx.submit(drafts);
        if (!written.ok) return written as never;
      }
      return ok({ stored: drafts.length, skipped });
    },
  };

  return { setCustomRate, deleteCustomRate, applyRateTable };
}
