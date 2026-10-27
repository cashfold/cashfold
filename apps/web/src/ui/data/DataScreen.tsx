'use client';

import { useRef } from 'react';
import { useFocusRequest } from '../desktop/focus-request';
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
  // "Import" and "Export" from the desktop shortcuts land here and put the focus on the first control of the panel.
  const importPanel = useRef<HTMLDivElement>(null);
  const exportPanel = useRef<HTMLDivElement>(null);
  useFocusRequest('data-import', () => focusFirstControl(importPanel.current));
  useFocusRequest('data-export', () => focusFirstControl(exportPanel.current));
  return (
    <LedgerFrame titleKey="page.data.title" withoutFold={<BackupPanel folds={ledger.folds} />}>
      <p className="mt-2 text-muted">{t('data.lede')}</p>
      <div ref={importPanel}><CsvImportPanel /></div>
      <div ref={exportPanel}><CsvExportPanel folds={ledger.folds} /></div>
      <BackupPanel folds={ledger.folds} />
    </LedgerFrame>
  );
}

function focusFirstControl(panel: HTMLElement | null): void {
  const control = panel?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
  control?.focus();
  control?.scrollIntoView({ block: 'center' });
}
