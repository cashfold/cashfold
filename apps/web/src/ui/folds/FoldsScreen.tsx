'use client';

import { CURRENCY_EXPONENTS, type FoldSummary } from '@cashfold/core';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { Hint } from '../firstrun/Hint';
import { useLedger } from '../ledger/LedgerProvider';
import { useI18n } from '../i18n/I18nProvider';
import { Modal } from '../forms/Modal';
import { InvitationsSection } from '../sharing/InvitationsSection';
import { MyCode } from '../sharing/MyCode';
import { SharingPanel } from '../sharing/SharingPanel';
import { KitReminder } from '../shell/KitReminder';
import { Button, Select } from '../kit';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
interface DeletionSummary { name: string; memberCount: number; isLastFold: boolean }

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS).sort();

export function FoldsScreen() {
  const { t } = useI18n();
  const core = useCore();
  const [folds, setFolds] = useState<readonly FoldSummary[]>([]);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<string | undefined>();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>();
  const [deleting, setDeleting] = useState<{ fold: FoldSummary; summary: DeletionSummary } | undefined>();
  const [confirmName, setConfirmName] = useState('');
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [sharing, setSharing] = useState<FoldSummary | undefined>();
  const [removedNotice, setRemovedNotice] = useState(false);
  const ledger = useLedger();
  const noticeShown = removedNotice || ledger.foldRemoved;
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => setFolds(await core.call<FoldSummary[]>('folds.list')), [core]);
  useEffect(() => void load().catch(() => setError(t('folds.error.generic'))), [load, t]);
  // A Fold this account was taken out of disappears from this device at the next contact (FR-104): say so, and what that cannot undo.
  useEffect(() => core.subscribe((e) => {
    if (e.type === 'FoldRemoved') {
      setRemovedNotice(true);
      setSharing(undefined);
    }
    if (e.type === 'RemoteChanged' || e.type === 'FoldRemoved') void load().catch(() => undefined);
  }), [core, load]);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);

  const messageFor = (code: string) => (t(`folds.error.${code}`) === `folds.error.${code}` ? t('folds.error.generic') : t(`folds.error.${code}`));

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const result = await core.call<Outcome<FoldSummary>>('folds.create', { name, baseCurrency: currency });
    if (result.ok) {
      setName('');
      await load();
    } else setError(messageFor(result.error.code));
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const result = await core.call<Outcome<string>>('folds.rename', { fold: renaming.id, name: renaming.name });
    if (result.ok) {
      setRenaming(undefined);
      setError(undefined);
      await load();
    } else setError(messageFor(result.error.code));
  }

  async function askDelete(fold: FoldSummary) {
    const summary = await core.call<DeletionSummary | null>('folds.describeDeletion', { fold: fold.id });
    if (summary) {
      setConfirmName('');
      setDialogError(undefined);
      setDeleting({ fold, summary });
    }
  }

  async function confirmDelete(event: FormEvent) {
    event.preventDefault();
    if (!deleting) return;
    const result = await core.call<Outcome<true>>('folds.delete', { fold: deleting.fold.id, confirmName });
    if (result.ok) {
      setDeleting(undefined);
      await load();
    } else setDialogError(result.error.code === 'last_fold' ? t('folds.delete.last') : messageFor(result.error.code));
  }

  return (
    <div>
      <KitReminder />
      <h1 className="text-2xl font-semibold">{t('page.folds.title')}</h1>
      <Hint id="folds-sharing" className="mt-3">{t('hint.folds')}</Hint>
      <p className="mt-3 text-muted">{t('folds.lede')}</p>

      {noticeShown ? (
        <div role="status" className="mt-4 rounded-ui border border-border-strong p-3" data-testid="fold-removed-notice">
          <p>{t('sharing.removed.notice')}</p>
          <p className="mt-1 text-sm text-muted">{t('sharing.removed.limit')}</p>
          <Button outline className="mt-2" type="button" onClick={() => { setRemovedNotice(false); ledger.dismissFoldRemoved(); }}>{t('sharing.removed.dismiss')}</Button>
        </div>
      ) : null}
      <InvitationsSection onChanged={() => void load()} />

      <h2 className="mt-6 text-lg font-semibold">{t('folds.list.label')}</h2>
      {folds.length === 0 ? <p className="mt-2 text-muted">{t('folds.empty')}</p> : null}
      <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong" aria-label={t('folds.list.label')}>
        {folds.map((fold) => (
          <li key={fold.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            {renaming?.id === fold.id ? (
              <form onSubmit={saveRename} className="flex flex-wrap items-end gap-2">
                <TextField label={t('folds.name.label')} value={renaming.name} onChange={(e) => setRenaming({ id: fold.id, name: e.target.value })} autoFocus />
                <Button type="submit" >{t('folds.rename.save')}</Button>
                <Button outline type="button" onClick={() => setRenaming(undefined)}>{t('folds.rename.cancel')}</Button>
              </form>
            ) : (
              <>
                <div>
                  <strong data-testid="fold-name">{fold.name}</strong>
                  <span className="ms-3 text-sm text-muted">{t(`folds.role.${fold.role}`)} · {t('folds.currency', { currency: fold.baseCurrency })}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button outline type="button" onClick={() => setSharing(fold)} aria-label={`${t('sharing.open')} ${fold.name}`}>{t('sharing.open')}</Button>
                </div>
                {fold.role === 'owner' ? (
                  <div className="flex gap-2">
                    <Button outline type="button" onClick={() => setRenaming({ id: fold.id, name: fold.name })} aria-label={`${t('folds.rename')} ${fold.name}`}>{t('folds.rename')}</Button>
                    <Button outline type="button" onClick={() => void askDelete(fold)} aria-label={`${t('folds.delete')} ${fold.name}`}>{t('folds.delete')}</Button>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-semibold">{t('folds.create.title')}</h2>
      <form onSubmit={create} className="max-w-md">
        <TextField label={t('folds.name.label')} value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="mt-4">
          <label htmlFor="fold-currency" className="block font-medium">{t('folds.currency.label')}</label>
          <Select id="fold-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <Button className="mt-4" type="submit" >{t('folds.create.submit')}</Button>
      </form>

      <MyCode />

      <Modal open={sharing !== undefined} title={sharing ? t('sharing.title', { name: sharing.name }) : ''} onClose={() => setSharing(undefined)}>
        {sharing ? <SharingPanel fold={sharing.id} name={sharing.name} onClose={() => setSharing(undefined)} onLeft={() => { setSharing(undefined); setRemovedNotice(false); void load(); }} /> : null}
      </Modal>

      <dialog ref={dialog} aria-labelledby="delete-title" className="max-w-md rounded-ui border border-border-strong bg-bg p-6 text-text" onClose={() => setDeleting(undefined)}>
        {deleting ? (
          <form onSubmit={confirmDelete}>
            <h2 id="delete-title" className="text-lg font-semibold">{t('folds.delete.title', { name: deleting.summary.name })}</h2>
            <p className="mt-3">{t('folds.delete.consequence', { name: deleting.summary.name, memberCount: deleting.summary.memberCount })}</p>
            {deleting.summary.isLastFold ? (
              <p className="mt-3 text-danger" role="alert">{t('folds.delete.last')}</p>
            ) : (
              <TextField label={t('folds.delete.confirm.label')} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} error={dialogError} autoFocus />
            )}
            <div className="mt-6 flex gap-3">
              {deleting.summary.isLastFold ? null : <Button type="submit" >{t('folds.delete.confirm')}</Button>}
              <Button outline type="button" onClick={() => setDeleting(undefined)}>{t('folds.delete.cancel')}</Button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
