import { ACCOUNT_KINDS, type AccountGroup, type AccountKind, type AccountRow, type CurrencyCode } from '@cashfold/core';

export interface CurrencyTotal {
  readonly currency: CurrencyCode;
  readonly minor: bigint;
}

export interface AccountSection {
  readonly key: string;
  readonly kind: 'group' | 'ungrouped' | 'type';
  readonly group?: AccountGroup;
  readonly accountKind?: AccountKind;
  readonly accounts: readonly AccountRow[];
  /** Per currency in code order; `'unavailable'` while a listed balance is unknown; `undefined` for an empty group and the type view. */
  readonly totals: readonly CurrencyTotal[] | 'unavailable' | undefined;
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
export function accountSections(input: { accounts: readonly AccountRow[]; groups: readonly AccountGroup[]; view: 'group' | 'type' }): AccountSection[] {
  const { accounts, groups, view } = input;
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
  const sections = groups.map((group): AccountSection => ({ key: `group-${group.id}`, kind: 'group', group, accounts: byGroup.get(group.id)!, totals: totalsOf(byGroup.get(group.id)!) }));
  if (loose.length > 0) sections.push({ key: 'ungrouped', kind: 'ungrouped', accounts: loose, totals: totalsOf(loose) });
  return sections;
}
