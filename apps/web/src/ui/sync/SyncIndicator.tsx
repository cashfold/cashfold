'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/I18nProvider';
import { indicatorView } from './indicator-view';
import { useSyncStatus } from './useSyncStatus';

/** One line in the header: whether this device is in step with the service, offline, or needs a look. */
export function SyncIndicator() {
  const { t } = useI18n();
  const { status } = useSyncStatus();
  if (status === undefined || !status.available) return null;

  const { textKey, tone: toneName, state, attention } = indicatorView(status);
  const text = t(textKey);
  const tone = toneName === 'warning' ? 'bg-(--warning)' : toneName === 'neutral' ? 'bg-zinc-400' : 'bg-(--success)';
  return (
    <p role="status" className="flex items-center gap-x-2 px-2 py-1 text-sm/6 text-zinc-600 dark:text-zinc-400" data-sync-state={state}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${tone}`} />
      <span>
        <Link href="/settings/sync/" className="underline-offset-4 hover:underline">{text}</Link>
        {attention ? <span> · {t('sync.attention')}</span> : null}
      </span>
    </p>
  );
}
