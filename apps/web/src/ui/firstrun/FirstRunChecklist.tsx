'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/I18nProvider';
import { Button, CheckIcon, Notice } from '../kit';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useAddSheet } from '../shell/add-context';
import { useChecklistStatus } from './checklist-status';

/** A skippable card on the Overview for a new Fold: create the Fold, add an account, add a transaction. Dismissing it is remembered on this device. */
export function FirstRunChecklist() {
  const { t } = useI18n();
  const { openAdd } = useAddSheet();
  const dismissed = usePrefs((p) => p.firstRun.dismissed);
  const { known, complete, steps } = useChecklistStatus();
  if (dismissed || !known || complete) return null;
  const dismiss = () => prefsStore.update((p) => ({ ...p, firstRun: { dismissed: true } }));
  return (
    <Notice className="mt-4" title={t('firstrun.title')} onDismiss={dismiss} dismissLabel={t('firstrun.dismiss')} data-testid="first-run">
      <ol className="mt-1 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-2">
            {s.done ? <CheckIcon aria-hidden="true" className="size-5 text-(--success)" /> : <span aria-hidden="true" className="size-5 rounded-full border border-zinc-400" />}
            <span className={s.done ? 'line-through' : ''}>{t(`firstrun.step.${s.id}`)}</span>
            {s.done ? <span className="sr-only">{t('firstrun.done')}</span> : s.id === 'account' ? <Link className="underline" href="/accounts/">{t('firstrun.go')}</Link> : s.id === 'transaction' ? <Button plain onClick={() => openAdd()}>{t('firstrun.go')}</Button> : s.id === 'backup' ? <Link className="underline" href="/settings/data/">{t('firstrun.go')}</Link> : null}
          </li>
        ))}
      </ol>
    </Notice>
  );
}
