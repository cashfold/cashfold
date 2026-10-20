import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { MAX_MINOR, MIN_MINOR } from '../../shared-kernel/money';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { Ledger } from './projections/ledger';

export type BalanceError = DomainError<'unknown_account' | 'out_of_range'>;

const fits = (v: bigint): boolean => v >= MIN_MINOR && v <= MAX_MINOR;

/**
 * balance(asOf) = opening balance + sum of posted entries dated on or before `asOf` (FR-028). Never stored.
 * The sum is exact (bigint); only the final value is range-checked, so the result does not depend on the
 * order entries are visited in. A balance beyond 64 bits is refused, never wrapped (FR-038).
 */
export function accountBalance(ledger: Ledger, account: Id, asOf?: LocalDate): Result<bigint, BalanceError> {
  const a = ledger.accounts.get(account);
  if (a === undefined) return err('unknown_account', 'That account does not exist');
  let sum = a.openingBalanceMinor;
  for (const e of ledger.entriesByAccount.get(account) ?? []) {
    if (e.status !== 'posted' || (asOf !== undefined && e.localDate > asOf)) continue;
    sum += e.amountMinor;
  }
  return fits(sum) ? ok(sum) : err('out_of_range', 'The balance is outside the supported range');
}

/** The amount of a balance adjustment that makes `balance(account, on)` equal `target`; zero means already equal (FR-034). */
export function adjustmentFor(ledger: Ledger, account: Id, on: LocalDate, target: bigint): Result<bigint, BalanceError> {
  const current = accountBalance(ledger, account, on);
  if (!current.ok) return current;
  const delta = target - current.value;
  return fits(delta) && fits(target) ? ok(delta) : err('out_of_range', 'The adjustment is outside the supported range');
}
