import {
  ACCOUNT_KINDS, endOfDayUtcS, groupBalances, type AccountGroup, type AccountKind, type AccountRow, type CurrencyCode, type ExchangeRate,
} from '@cashfold/core';
import { todayLocal } from '../ledger/dates';

export interface CurrencyTotal {
  readonly currency: CurrencyCode;
  readonly minor: bigint;
}

/** A group's accounts in the group's own currency, with the rates behind it (spec 021). */
export interface SectionConversion {
  readonly currency: CurrencyCode;
  /** `null` when no account could be converted. */
  readonly subtotalMinor: bigint | null;
  /** The oldest rate date used, in UTC seconds; `null` when no rate was needed. */
  readonly ratesFrom: number | null;
  readonly missing: readonly CurrencyCode[];
  readonly overflow: boolean;
}

export interface AccountSection {
  readonly key: string;
  readonly kind: 'group' | 'ungrouped' | 'type';
  readonly group?: AccountGroup;
  readonly accountKind?: AccountKind;
  readonly accounts: readonly AccountRow[];
  /** Per currency in code order; `'unavailable'` while a listed balance is unknown; `undefined` for an empty group and the type view. */
  readonly totals: readonly CurrencyTotal[] | 'unavailable' | undefined;
  /** Only for a group that has accounts, when rates were given. */
  readonly converted?: SectionConversion;
}

/** The group an account is shown under: the first of its groups that exists, in the groups' order (FR-017). */
export function groupOf(account: AccountRow, groups: readonly AccountGroup[]): AccountGroup | undefined {
  return groups.find((g) => account.groupIds.includes(g.id));
}

function totalsOf(accounts: readonly AccountRow[]): AccountSection['totals'] {
  if (accounts.length === 0) return undefined;
  const sums = new Map<CurrencyCode, bigint>();
  for (const a of accounts) {
    if (a.balanceMinor === null) return 'unavailable';
    sums.set(a.currency, (sums.get(a.currency) ?? 0n) + a.balanceMinor);
  }
  return [...sums].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([currency, minor]) => ({ currency, minor }));
}

/** The sections the Accounts page draws: one per group (then Ungrouped) in the group view, one per account type in the type view. */
export function accountSections(input: {
  accounts: readonly AccountRow[]; groups: readonly AccountGroup[]; view: 'group' | 'type';
  /** With the rates, a group's subtotal is converted to the group's currency (its own, else `baseCurrency`, else USD). */
  rates?: readonly ExchangeRate[] | undefined; baseCurrency?: string | undefined; asOfUtcS?: number | undefined;
}): AccountSection[] {
  const { accounts, groups, view, rates } = input;
  if (view === 'type') {
    return ACCOUNT_KINDS.map((accountKind): AccountSection => ({
      key: `kind-${accountKind}`, kind: 'type', accountKind, accounts: accounts.filter((a) => a.kind === accountKind), totals: undefined,
    })).filter((s) => s.accounts.length > 0);
  }
  const byGroup = new Map<string, AccountRow[]>(groups.map((g) => [g.id, []]));
  const loose: AccountRow[] = [];
  for (const a of accounts) {
    const g = groupOf(a, groups);
    (g ? byGroup.get(g.id)! : loose).push(a);
  }
  const asOfUtcS = input.asOfUtcS ?? endOfDayUtcS(todayLocal());
  const sections = groups.map((group): AccountSection => {
    const own = byGroup.get(group.id)!;
    const section: AccountSection = { key: `group-${group.id}`, kind: 'group', group, accounts: own, totals: totalsOf(own) };
    if (rates === undefined || own.length === 0) return section;
    const currency = (group.currency ?? input.baseCurrency ?? 'USD') as CurrencyCode;
    const r = groupBalances({ accounts: own, groupCurrency: currency, rates, asOfUtcS });
    const dates = r.rows.map((x) => x.rateAsOf).filter((d): d is number => d !== null);
    const ratesFrom = dates.length === 0 ? null : dates.reduce((a, b) => (b < a ? b : a));
    return { ...section, converted: { currency, subtotalMinor: r.subtotalMinor, ratesFrom, missing: r.missing, overflow: r.overflow } };
  });
  if (loose.length > 0) sections.push({ key: 'ungrouped', kind: 'ungrouped', accounts: loose, totals: totalsOf(loose) });
  return sections;
}
