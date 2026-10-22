'use client';

import { decideBackupNag, type NagLevel } from '@cashfold/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { requestPersistence, type PersistenceState } from '../../adapters/storage-persistence';
import { useCore } from '../core/CoreProvider';
import { secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { useOptionalLedger } from '../ledger/LedgerProvider';

interface Status {
  recovery?: { reason: 'unreadable' | 'damaged'; incomplete: string[]; rebuilt: number; refetch: number; blocked: number; atMs: number };
  hasData: boolean;
  onService: boolean;
  lastBackupAtMs: number;
  dismissedAtMs: number;
}

/**
 * Asks the browser to keep this site's storage once the app is unlocked, says so when it will not, and reminds people to make an encrypted
 * backup when losing the data on this device would be the end of it (ARCHITECTURE 8.1a, FR-072).
 */
export function StorageNotice() {
  const { t } = useI18n();
  const core = useCore();
  const [persistence, setPersistence] = useState<PersistenceState | undefined>();
  const [status, setStatus] = useState<Status | undefined>();
  const [hidden, setHidden] = useState(false);
  const [recoveryRead, setRecoveryRead] = useState(false);
  const dataVersion = useOptionalLedger()?.version ?? 0; // what there is to lose changes with every saved change
  const pathname = usePathname(); // what there is to lose changes as the person works: ask again when they move to another screen

  useEffect(() => {
    if (core.phase !== 'unlocked') return;
    let live = true;
    void requestPersistence().then((p) => live && setPersistence(p));
    void core.call<Status>('storage.status').then((s) => live && setStatus(s), () => undefined);
    return () => {
      live = false;
    };
  }, [core, core.phase, core.epoch, pathname, dataVersion]);

  if (core.phase !== 'unlocked' || persistence === undefined || status === undefined) return null;
  if (status.recovery !== undefined && !recoveryRead) {
    return (
      <aside role="alert" aria-label={t('storage.recovery.label')} data-testid="recovery-notice" className="border-b border-border-strong bg-surface px-4 py-3">
        <p className="font-medium">{t('storage.recovery.title')}</p>
        <p className="mt-1">{t(status.onService ? 'storage.recovery.service' : 'storage.recovery.local')}</p>
        {status.recovery.blocked > 0 ? <p className="mt-1">{t('storage.recovery.blocked', { count: status.recovery.blocked })}</p> : null}
        {!status.onService ? <p className="mt-1"><Link className="underline" href="/settings/data/">{t('storage.recovery.restore')}</Link></p> : null}
        <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={() => setRecoveryRead(true)}>{t('storage.recovery.ok')}</button>
      </aside>
    );
  }
  if (hidden) return null;
  const level: NagLevel = decideBackupNag({ persisted: persistence.persisted, onService: status.onService, hasData: status.hasData, lastBackupAtMs: status.lastBackupAtMs, dismissedAtMs: status.dismissedAtMs, nowMs: Date.now() });
  const refused = persistence.persisted !== true && status.hasData;
  if (level === 'none' && !refused) return null;

  const dismiss = async () => {
    setHidden(true);
    await core.call('settings.set', { backupNagDismissedAtMs: Date.now() }).catch(() => undefined);
  };
  return (
    <aside aria-label={t('storage.notice.label')} data-testid="storage-notice" data-level={level} className="border-b border-border-strong bg-surface px-4 py-3">
      {refused ? <p role="status" data-testid="storage-warning">{t(status.onService ? 'storage.refused.service' : 'storage.refused.local')}</p> : null}
      {level !== 'none' ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <p className="flex-1" data-testid="backup-nag">{t(level === 'strong' ? 'storage.backup.strong' : 'storage.backup.gentle')} <Link className="underline" href="/settings/data/">{t('storage.backup.link')}</Link></p>
          <button type="button" className={secondaryButtonClass} onClick={() => void dismiss()}>{t(level === 'strong' ? 'storage.backup.later' : 'storage.backup.dismiss')}</button>
        </div>
      ) : null}
    </aside>
  );
}
