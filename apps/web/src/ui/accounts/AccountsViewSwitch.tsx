'use client';

import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Label, Radio, RadioField, RadioGroup } from '../kit';
import { prefsStore } from '../prefs/usePrefs';

/** "By group" / "By type": a labelled radio group, so the choice is announced and reachable with the keyboard. */
export function AccountsViewSwitchView({ t, value, onChange }: { t: Translate; value: 'group' | 'type'; onChange: (value: 'group' | 'type') => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span aria-hidden="true" className="text-sm font-medium">{t('ledger.accounts.view.label')}</span>
      <RadioGroup aria-label={t('ledger.accounts.view.label')} value={value} onChange={(v: string) => onChange(v === 'type' ? 'type' : 'group')} className="flex flex-wrap gap-x-5 gap-y-1 *:m-0">
        <RadioField className="items-center"><Radio value="group" /><Label>{t('ledger.accounts.view.byGroup')}</Label></RadioField>
        <RadioField className="items-center"><Radio value="type" /><Label>{t('ledger.accounts.view.byType')}</Label></RadioField>
      </RadioGroup>
    </div>
  );
}

/** Stores the first choice, which also ends the automatic behaviour (spec D-4). */
export function AccountsViewSwitch({ value }: { value: 'group' | 'type' }) {
  const { t } = useI18n();
  return (
    <AccountsViewSwitchView t={t} value={value} onChange={(choice) => prefsStore.update((p) => ({ ...p, lists: { ...p.lists, accountsView: choice } }))} />
  );
}
