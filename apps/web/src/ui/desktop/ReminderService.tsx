'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { amountsAllowed, permission, rememberShown, show, shownKeys } from '../../adapters/notifications/browser';
import { isDesktopApp } from '../../adapters/platform/detect';
import { useI18n } from '../i18n/I18nProvider';
import { formatDate } from '../ledger/dates';
import { useLedger } from '../ledger/LedgerProvider';
import { createReminderService } from './reminder-service';

/**
 * Shows reminders that have come due, once each, on whatever screen is open and, in the desktop app, while the window is hidden. Mounted once in the
 * unlocked shell; the page's own notification is shown natively by the desktop app. Choosing one brings the window forward and opens the schedules.
 */
export function ReminderService() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const router = useRouter();
  const latest = useRef({ t, locale, ledger, router });
  latest.current = { t, locale, ledger, router };
  const foldId = ledger.fold?.id;

  useEffect(() => {
    if (foldId === undefined) return;
    const service = createReminderService({
      unlocked: () => true, // this component only exists while the session is unlocked
      readReminders: () => latest.current.ledger.read<import('@cashfold/core').Reminder[]>('schedules.reminders'),
      every: (run, ms) => {
        const timer = setInterval(run, ms);
        return () => clearInterval(timer);
      },
      notify: {
        permission,
        show: (text) =>
          show(text, () => {
            if (isDesktopApp()) void import('../../adapters/platform').then((m) => m.getDesktopBridge()?.showWindow());
            else window.focus();
            latest.current.router.push('/plan/?view=schedules');
          }),
        alreadyShown: shownKeys,
        remember: rememberShown,
        showAmounts: amountsAllowed(),
        copy: {
          title: (name) => latest.current.t('schedules.notify.message.title', { name }),
          body: (date) => latest.current.t('schedules.notify.message.body', { date }),
          bodyWithAmount: (date, amount) => latest.current.t('schedules.notify.message.bodyAmount', { date, amount }),
          many: (count) => ({ title: latest.current.t('schedules.notify.message.many', { count }), body: latest.current.t('schedules.notify.message.manyBody') }),
        },
        formatDate: (d) => formatDate(d, latest.current.locale),
        formatAmount: (minor, currency) => latest.current.ledger.money(minor, currency),
        currencyOf: (account) => latest.current.ledger.basics?.accounts.find((a) => a.id === account)?.currency,
      },
    });
    return service.start();
  }, [ledger.version, foldId]);
  return null;
}
