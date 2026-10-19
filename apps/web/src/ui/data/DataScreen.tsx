'use client';

import { useI18n } from '../i18n/I18nProvider';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';
import { BackupPanel } from './BackupPanel';
import { CsvExportPanel } from './CsvExportPanel';
import { CsvImportPanel } from './CsvImportPanel';

/** Everything that moves data in and out of the app: CSV import and export, encrypted backups (FR-090 to FR-092). */
export function DataScreen() {
  const { t } = useI18n();
  const ledger = useLedger();
  return (
    <LedgerFrame titleKey="page.data.title">
      <p className="mt-2 text-muted">{t('data.lede')}</p>
      <CsvImportPanel />
      <CsvExportPanel folds={ledger.folds} />
      <BackupPanel folds={ledger.folds} />
    </LedgerFrame>
  );
}
