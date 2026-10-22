'use client';

import { useI18n } from '../i18n/I18nProvider';
import { useLedger } from '../ledger/LedgerProvider';
import { ChevronDownIcon, Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu } from '../kit';

/**
 * The current Fold's name, always shown (FR-005). With more than one Fold it is also the switcher: choosing another Fold changes the data every
 * screen shows. It replaces the per-screen picker.
 */
export function FoldSwitcher() {
  const { t } = useI18n();
  const ledger = useLedger();
  if (ledger.fold === undefined) return null;
  const name = ledger.fold.name;
  if (ledger.folds.length < 2) {
    return (
      <p className="px-2 py-1 text-sm/6 text-zinc-600 dark:text-zinc-400">
        <span className="sr-only">{t('shell.currentFold')}: </span>
        <span data-testid="current-fold">{name}</span>
      </p>
    );
  }
  return (
    <Dropdown>
      <DropdownButton plain className="w-full justify-between" aria-label={`${t('shell.foldSwitcher')}: ${name}`}>
        <span data-testid="current-fold" className="truncate">{name}</span>
        <ChevronDownIcon data-slot="icon" aria-hidden="true" />
      </DropdownButton>
      <DropdownMenu anchor="bottom start">
        {ledger.folds.map((fold) => (
          <DropdownItem key={fold.id} onClick={() => ledger.selectFold(fold.id)} aria-current={fold.id === ledger.fold?.id ? 'true' : undefined}>
            <DropdownLabel>{fold.name}</DropdownLabel>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
