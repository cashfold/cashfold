'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/I18nProvider';
import { useSyncStatus } from './useSyncStatus';

/** One line in the header: whether this device is in step with the service, offline, or needs a look. */
export function SyncIndicator() {
  const { t } = useI18n();
  const { status } = useSyncStatus();
  if (status === undefined || !status.available) return null;

  const attention = status.attention.length + status.clock.length > 0;
  let text: string;
  if (status.connection === 'not_registered') text = t('sync.state.not_registered');
  else if (status.connection === 'needs_password') text = t('sync.state.needs_password');
  else if (status.connection === 'removed') text = t('sync.state.removed');
  else if (status.overall === 'syncing' || status.connection === 'connecting') text = t('sync.state.syncing');
  else if (status.overall === 'offline' || status.connection === 'offline') text = t('sync.state.offline');
  else if (status.overall === 'error') text = t('sync.state.error');
  else text = t('sync.state.synced');

  return (
    <p role="status" className="text-sm text-muted" data-sync-state={status.connection === 'online' ? status.overall : status.connection}>
      <Link href="/settings/sync/" className="underline-offset-4 hover:underline">{text}</Link>
      {attention ? <span> · {t('sync.attention')}</span> : null}
    </p>
  );
}
