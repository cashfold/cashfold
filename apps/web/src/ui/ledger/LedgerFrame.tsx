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
    <div>
      <KitReminder />
      <div className="flex flex-wrap items-center justify-between gap-3 *:min-w-0">
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        {actions}
      </div>
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
    </div>
  );
}
