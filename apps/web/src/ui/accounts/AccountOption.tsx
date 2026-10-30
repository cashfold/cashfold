'use client';

import type { AccountRow } from '@cashfold/core';
import { Amount, ListboxLabel, ListboxOption } from '../kit';
import { useI18n } from '../i18n/I18nProvider';

type OptionAccount = Pick<AccountRow, 'id' | 'name' | 'currency' | 'balanceMinor'>;

/**
 * One account in an account dropdown: the name (it shortens when long) and, at the end, the account's balance in its own currency, the same
 * figure the Accounts page shows. The balance is plain text in its own block, so a screen reader reads the name, then the balance. Colour is not
 * used: it would clash with the highlighted option, and the sign is already in the text. No balance (too large to hold) shows the name alone.
 * Use it inside a kit `Select` in place of a `SelectOption`.
 */
export function AccountOption({ account }: { account: OptionAccount }) {
  const { locale } = useI18n();
  return <AccountOptionView account={account} locale={locale} />;
}

export function AccountOptionView({ account, locale }: { account: OptionAccount; locale: string }) {
  return (
    <ListboxOption<string> value={account.id}>
      <ListboxLabel>{account.name}</ListboxLabel>
      {account.balanceMinor === null ? null : (
        <span className="ms-auto shrink-0 ps-4" data-testid="account-option-balance">
          <Amount minor={account.balanceMinor} currency={account.currency} locale={locale} />
        </span>
      )}
    </ListboxOption>
  );
}
