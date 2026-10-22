'use client';

import type { LocalDate, RecentlyDeletedTransfer, TransferRow } from '@cashfold/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../../forms/Modal';

import { useI18n } from '../../i18n/I18nProvider';
import { formatDate, formatDateTime } from '../dates';
import { useLedger } from '../LedgerProvider';
import { RateManager } from './RateManager';
import { AddSheet } from '../../transactions/AddSheet';
import { Button } from '../../kit';

/** The transfers of the Fold, listed under the transactions; they are entered and edited in the same sheet (transfer mode). */
export function TransfersSection() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [deleted, setDeleted] = useState<RecentlyDeletedTransfer[]>([]);
  const [editing, setEditing] = useState<TransferRow | undefined>();
  const [removing, setRemoving] = useState<TransferRow | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const accounts = useMemo(() => new Map(basics.accounts.map((a) => [a.id, a])), [basics.accounts]);

  const load = useCallback(async () => {
    try {
      const [list, gone] = await Promise.all([ledger.read<TransferRow[]>('ledger.transfers'), ledger.read<RecentlyDeletedTransfer[]>('ledger.recentlyDeletedTransfers')]);
      setRows(list);
      setDeleted(gone);
    } catch {
      setMessage(t('ledger.error.load'));
    }
  }, [ledger.version, t]);
  useEffect(() => void load(), [load]);

  const groups = useMemo(() => {
    const out: Array<{ date: LocalDate; items: TransferRow[] }> = [];
    for (const row of rows) {
      const last = out.at(-1);
      if (last?.date === row.localDate) last.items.push(row);
      else out.push({ date: row.localDate, items: [row] });
    }
    return out;
  }, [rows]);

  async function confirmRemove() {
    if (!removing) return;
    const r = await ledger.run('ledger.deleteTransfer', { id: removing.id });
    if (r.ok) setRemoving(undefined);
    else setMessage(ledger.explain(r.error.code));
  }

  return (
    <section className="mt-10" aria-labelledby="xfers-title">
      <h2 id="xfers-title" className="text-lg font-semibold">{t('page.transfers.title')}</h2>
      <p className="mt-1 text-muted">{t('ledger.xfer.lede')}</p>
      {basics.accounts.length < 2 ? <p className="mt-3 text-muted">{t('ledger.xfer.needTwo')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}
      <p className="mt-4 text-sm text-muted" role="status" data-testid="xfer-count">{t('ledger.xfer.count', { count: rows.length })}</p>

      {groups.map((group) => (
        <section key={group.date} className="mt-5" aria-labelledby={`xday-${group.date}`}>
          <h2 id={`xday-${group.date}`} className="text-base font-semibold text-muted">{formatDate(group.date, locale)}</h2>
          <ul className="mt-1 divide-y divide-border-strong rounded-ui border border-border-strong">
            {group.items.map((x) => {
              const [from, to] = [accounts.get(x.fromAccountId), accounts.get(x.toAccountId)];
              const title = `${from?.name ?? '?'} → ${to?.name ?? '?'}`;
              return (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="xfer-row">
                  <div>
                    <div className="font-medium">
                      {title}
                      {x.status === 'posted' ? null : <span className="ms-2 rounded-ui border border-border-strong px-2 text-sm">{t(`ledger.status.${x.status}`)}</span>}
                    </div>
                    <div className="text-sm text-muted">
                      <span data-testid="xfer-out">{from ? ledger.signed(-x.fromAmountMinor, from.currency) : ''}</span>
                      {' → '}
                      <span data-testid="xfer-in">{to ? ledger.signed(x.toAmountMinor, to.currency) : ''}</span>
                      {x.note !== '' ? ` · ${x.note}` : ''}
                      {x.lastChanged ? ` · ${t('ledger.tx.lastChanged', { when: formatDateTime(x.lastChanged.atMs, locale), device: x.lastChanged.dev === basics.thisDevice ? t('ledger.tx.thisDevice') : t('ledger.tx.otherDevice') })}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button outline type="button" onClick={() => setEditing(x)} aria-label={`${t('ledger.edit')} ${title}`}>{t('ledger.edit')}</Button>
                    <Button outline type="button" onClick={() => setRemoving(x)} aria-label={`${t('ledger.delete')} ${title}`}>{t('ledger.delete')}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="mt-10" aria-labelledby="xdeleted-title">
        <h2 id="xdeleted-title" className="text-lg font-semibold">{t('ledger.deleted.title')}</h2>
        {deleted.length === 0 ? <p className="mt-2 text-muted">{t('ledger.deleted.empty')}</p> : null}
        <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" data-testid="xfer-deleted">
          {deleted.map((d) => (
            <li key={d.transfer.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <span>
                {accounts.get(d.transfer.fromAccountId)?.name} → {accounts.get(d.transfer.toAccountId)?.name}
                <span className="ms-3 text-sm text-muted">{formatDate(d.transfer.localDate, locale)} · {t('ledger.deleted.daysLeft', { days: d.daysLeft })}</span>
              </span>
              <Button outline type="button" onClick={async () => { const r = await ledger.run('ledger.restoreTransfer', { id: d.transfer.id }); if (!r.ok) setMessage(ledger.explain(r.error.code)); }}>{t('ledger.deleted.restore')}</Button>
            </li>
          ))}
        </ul>
      </section>

      <RateManager />

      {editing ? <AddSheet key={editing.id} existingTransfer={editing} onClose={() => setEditing(undefined)} /> : null}

      <Modal open={removing !== undefined} title={t('ledger.xfer.delete.title')} onClose={() => setRemoving(undefined)}>
        {removing ? (
          <div>
            <p className="mt-3">{t('ledger.xfer.delete.consequence')}</p>
            <div className="mt-6 flex gap-3">
              <Button type="button" onClick={() => void confirmRemove()}>{t('ledger.xfer.delete.confirm')}</Button>
              <Button outline type="button" onClick={() => setRemoving(undefined)}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
