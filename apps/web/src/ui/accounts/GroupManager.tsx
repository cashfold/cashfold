'use client';

import type { AccountGroup } from '@cashfold/core';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../kit';

/** The type view's list of groups, always visible, each with rename and delete. Nothing is drawn while there are no groups. */
export function GroupManager({ groups, onRename, onDelete }: { groups: readonly AccountGroup[]; onRename: (group: AccountGroup) => void; onDelete: (group: AccountGroup) => void }) {
  const { t } = useI18n();
  if (groups.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="account-groups-heading">
      <h2 id="account-groups-heading" className="text-lg font-semibold">{t('ledger.groups.title')}</h2>
      <p className="mt-1 text-muted">{t('ledger.groups.lede')}</p>
      <ul className="mt-2 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10" aria-label={t('ledger.groups.title')}>
        {groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="group-row">
            <span className="min-w-0 break-words font-medium">{g.name}</span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" outline onClick={() => onRename(g)} aria-label={`${t('ledger.groups.rename')}: ${g.name}`}>{t('ledger.groups.rename')}</Button>
              <Button type="button" outline onClick={() => onDelete(g)} aria-label={`${t('ledger.groups.delete')}: ${g.name}`}>{t('ledger.groups.delete')}</Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
