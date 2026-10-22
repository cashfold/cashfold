'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, CheckIcon, Notice } from '../kit';
import { useLedger } from '../ledger/LedgerProvider';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useAddSheet } from '../shell/add-context';
import { checklistState } from './checklist';

/** A skippable card on the Overview for a new Fold: create the Fold, add an account, add a transaction. Dismissing it is remembered on this device. */
export function FirstRunChecklist() {
  const { t } = useI18n();
  const ledger = useLedger();
  const { openAdd } = useAddSheet();
  const dismissed = usePrefs((p) => p.firstRun.dismissed);
  const [transactions, setTransactions] = useState<number | undefined>();
  useEffect(() => {
    let live = true;
    ledger.read<{ count: number }>('ledger.transactions', { filter: {}, sort: 'date_desc', page: { limit: 1, offset: 0 } }).then((r) => live && setTransactions(r.count), () => undefined);
    return () => { live = false; };
  }, [ledger.version]);
  if (dismissed || ledger.basics === undefined || transactions === undefined) return null;
  const { steps, complete } = checklistState({ folds: ledger.folds.length, accounts: ledger.basics.accounts.length, transactions });
  if (complete) return null;
  const dismiss = () => prefsStore.update((p) => ({ ...p, firstRun: { dismissed: true } }));
  return (
    <Notice className="mt-4" title={t('firstrun.title')} onDismiss={dismiss} dismissLabel={t('firstrun.dismiss')} data-testid="first-run">
      <ol className="mt-1 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-2">
            {s.done ? <CheckIcon aria-hidden="true" className="size-5 text-(--success)" /> : <span aria-hidden="true" className="size-5 rounded-full border border-zinc-400" />}
            <span className={s.done ? 'line-through' : ''}>{t(`firstrun.step.${s.id}`)}</span>
            {s.done ? <span className="sr-only">{t('firstrun.done')}</span> : s.id === 'account' ? <Link className="underline" href="/accounts/">{t('firstrun.go')}</Link> : s.id === 'transaction' ? <Button plain onClick={() => openAdd()}>{t('firstrun.go')}</Button> : null}
          </li>
        ))}
      </ol>
    </Notice>
  );
}
