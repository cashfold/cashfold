'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { KitReminder } from '../shell/KitReminder';
import { useLedger } from './LedgerProvider';

/** The common top of every ledger screen: heading, Fold picker, and the right message while loading or empty. */
export function LedgerFrame({ titleKey, children, actions, withoutFold }: { titleKey: string; children: ReactNode; actions?: ReactNode; withoutFold?: ReactNode }) {
  const { t } = useI18n();
  const ledger = useLedger();
  return (
    <main id="main" tabIndex={-1}>
      <KitReminder />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        {actions}
      </div>
      {ledger.folds.length > 1 ? (
        <div className="mt-3">
          <label htmlFor="ledger-fold" className="me-2 font-medium">{t('ledger.fold.label')}</label>
          <select
            id="ledger-fold" className="rounded-ui border border-border-strong bg-bg px-3 py-2" value={ledger.fold?.id}
            onChange={(e) => ledger.selectFold(e.target.value)}
          >
            {ledger.folds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      ) : null}
      {ledger.failed ? (
        <p role="alert" className="mt-4 text-danger">{t('ledger.error.load')}</p>
      ) : ledger.basics === undefined ? (
        <>
          <p role="status" className="mt-4 text-muted">{ledger.loading ? t('loading') : t('ledger.noFold')}</p>
          {ledger.loading ? null : withoutFold}
        </>
      ) : (
        children
      )}
    </main>
  );
}
