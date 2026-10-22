'use client';

import type { TransactionRow, TransferRow } from '@cashfold/core';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button, ConfirmDialog, Sheet, Tabs } from '../kit';
import { useLedger } from '../ledger/LedgerProvider';
import type { AddRequest } from '../shell/add-context';
import { useStatus } from '../shell/StatusProvider';
import type { ModeReport } from './modes';
import { TransactionMode, type TxKind } from './TransactionMode';
import { TransferMode } from './TransferMode';

const FORM_ID = 'add-sheet-form';
type Mode = 'expense' | 'income' | 'transfer';

/**
 * The one place a transaction or transfer is entered or edited (FR-007). Opens over any screen; amount focused, five fields, the rest under
 * "More details". Closing with unsaved input asks first (FR-011). The commands and payloads are those of the former forms (FR-048).
 */
export function AddSheet({ request, existing, existingTransfer, onClose }: { request?: AddRequest | undefined; existing?: TransactionRow | undefined; existingTransfer?: TransferRow | undefined; onClose: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const status = useStatus();
  const editing = existing !== undefined || existingTransfer !== undefined;
  const [mode, setMode] = useState<Mode>(existingTransfer ? 'transfer' : existing ? (existing.direction === 'income' ? 'income' : 'expense') : (request?.type ?? 'expense'));
  const dirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const report = useMemo<ModeReport>(
    () => ({
      dirty: (d) => { dirty.current = d; },
      busy: setBusy,
      rateMode: setRate,
      done: (key) => { dirty.current = false; status.notify(key); onClose(); },
    }),
    [status, onClose],
  );
  const requestClose = useCallback(() => {
    if (dirty.current) setConfirming(true);
    else onClose();
  }, [onClose]);

  const noAccounts = ledger.basics !== undefined && ledger.basics.accounts.length === 0;
  const adjustment = existing?.direction === 'adjustment';
  const key = mode === 'transfer' ? 'transfer' : 'transaction';

  return (
    <>
      <Sheet
        open onClose={requestClose} size="md"
        title={editing ? t('ledger.add.edit') : t('ledger.add.title')}
        footer={noAccounts ? null : (
          <>
            <Button plain type="button" onClick={requestClose}>{t('ledger.cancel')}</Button>
            <Button type="submit" form={FORM_ID} disabled={busy}>{rate ? t('ledger.rate.save') : t('ledger.add.save')}</Button>
          </>
        )}
      >
        {ledger.basics === undefined ? <p role="status">{t('loading')}</p> : noAccounts ? (
          <p>{t('ledger.tx.noAccounts')}</p>
        ) : (
          <div className="space-y-4">
            {editing || rate ? null : (
              <Tabs value={mode} onChange={(v) => { dirty.current = false; setMode(v as Mode); }} label={t('ledger.add.kind.label')}
                items={(['expense', 'income', 'transfer'] as const).map((k) => ({ value: k, label: t(`ledger.add.kind.${k}`) }))} />
            )}
            {mode === 'transfer'
              ? <TransferMode key={key} formId={FORM_ID} existing={existingTransfer} accountId={request?.accountId} report={report} />
              : <TransactionMode key={key} formId={FORM_ID} kind={(adjustment ? 'adjustment' : mode) as TxKind} existing={existing} accountId={request?.accountId} report={report} />}
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={confirming} title={t('ledger.add.discard.title')} body={t('ledger.add.discard.body')} confirmLabel={t('ledger.add.discard.confirm')} cancelLabel={t('ledger.add.keepEditing')} destructive
        onConfirm={() => { setConfirming(false); dirty.current = false; onClose(); }} onCancel={() => setConfirming(false)}
      />
    </>
  );
}
