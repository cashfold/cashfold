'use client';

import { useI18n } from '../i18n/I18nProvider';
import { Button, Notice } from '../kit';
import { formatDate } from '../ledger/dates';
import { useLedger } from '../ledger/LedgerProvider';
import { useScheduleInbox } from './useScheduleInbox';

/** Scheduled entries that wait for a yes: confirm or skip them where the transactions are (FR-013, plan R-UX-14). */
export function ScheduleInboxBanner() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const pending = useScheduleInbox();
  if (pending.length === 0) return null;
  const act = (method: string, p: (typeof pending)[number]) => void ledger.run(method, { schedule: p.scheduleId, n: p.n });
  return (
    <Notice className="mt-4" title={t('schedules.inbox.banner', { count: pending.length })} data-testid="inbox-banner">
      <ul className="mt-1 divide-y divide-zinc-950/10 dark:divide-white/10">
        {pending.map((p) => (
          <li key={`${p.scheduleId}:${p.n}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="pending-row">
            <span><strong>{p.scheduleName}</strong> <span className="text-sm text-zinc-600 dark:text-zinc-400">{formatDate(p.record.localDate, locale)}</span></span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => act('schedules.confirm', p)} aria-label={`${t('schedules.confirm')} ${p.scheduleName}`}>{t('schedules.confirm')}</Button>
              <Button outline type="button" onClick={() => act('schedules.skip', p)} aria-label={`${t('schedules.skip')} ${p.scheduleName}`}>{t('schedules.skip')}</Button>
            </span>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
