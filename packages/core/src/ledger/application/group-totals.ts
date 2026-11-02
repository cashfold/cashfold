import type { CurrencyCode } from '../../shared-kernel/currency';
import { convert } from '../../shared-kernel/fx';
import type { Id } from '../../shared-kernel/id';
import { MAX_MINOR, MIN_MINOR, money } from '../../shared-kernel/money';
import { PIVOT_RATE } from '../../shared-kernel/rate';
import { nearestPrior, PIVOT_CURRENCY, type ExchangeRate } from '../domain/exchange-rate';

export interface GroupBalanceAccount {
  readonly id: Id;
  readonly currency: CurrencyCode;
  /** `null` while the balance is unknown; such an account is skipped. */
  readonly balanceMinor: bigint | null;
}

export interface GroupBalanceRow {
  readonly id: Id;
  /** The balance in the group's currency; `null` when a rate is missing or the result is out of range. */
  readonly convertedMinor: bigint | null;
  /** Seconds of the older of the two rates used; `null` when none was needed or none was found. */
  readonly rateAsOf: number | null;
}

export interface GroupBalances {
  readonly currency: CurrencyCode;
  readonly rows: readonly GroupBalanceRow[];
  /** The sum of the converted figures; `null` when none could be converted. */
  readonly subtotalMinor: bigint | null;
  readonly missing: readonly CurrencyCode[];
  readonly overflow: boolean;
}

/**
 * A group's accounts shown in the group's currency, by the Overview's rule: the latest rate dated on or before `asOfUtcS`,
 * one division, one half-even rounding per account. The subtotal is the plain sum of the figures returned.
 */
export function groupBalances(input: { accounts: readonly GroupBalanceAccount[]; groupCurrency: CurrencyCode; rates: readonly ExchangeRate[]; asOfUtcS: number }): GroupBalances {
  const { groupCurrency: target, rates, asOfUtcS } = input;
  const missing = new Set<CurrencyCode>();
  const rows: GroupBalanceRow[] = [];
  let total = 0n;
  let converted = false;
  let overflow = false;
  const rateOf = (currency: CurrencyCode) => (currency === PIVOT_CURRENCY ? { rateE12: PIVOT_RATE, asOfUtcS: null } : nearestPrior(rates, currency, asOfUtcS));

  for (const a of input.accounts) {
    if (a.balanceMinor === null) continue;
    if (a.currency === target) {
      rows.push({ id: a.id, convertedMinor: a.balanceMinor, rateAsOf: null });
      total += a.balanceMinor;
      converted = true;
      continue;
    }
    const from = rateOf(a.currency);
    const to = rateOf(target);
    const amount = money(a.balanceMinor, a.currency);
    if (from === undefined || to === undefined || !amount.ok) {
      if (from === undefined) missing.add(a.currency);
      if (to === undefined) missing.add(target);
      rows.push({ id: a.id, convertedMinor: null, rateAsOf: null });
      continue;
    }
    const result = convert(amount.value, target, from.rateE12, to.rateE12);
    if (!result.ok) {
      overflow = true;
      rows.push({ id: a.id, convertedMinor: null, rateAsOf: null });
      continue;
    }
    const [x, y] = [from.asOfUtcS, to.asOfUtcS];
    rows.push({ id: a.id, convertedMinor: result.value.minor, rateAsOf: x === null ? y : y === null ? x : x < y ? x : y });
    total += result.value.minor;
    converted = true;
  }
  const fits = total >= MIN_MINOR && total <= MAX_MINOR;
  if (converted && !fits) overflow = true;
  return { currency: target, rows, subtotalMinor: converted && fits ? total : null, missing: [...missing].sort(), overflow };
}
