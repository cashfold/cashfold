'use client';

import { CURRENCY_EXPONENTS, type FoldSummary } from '@cashfold/core';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

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
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => setFolds(await core.call<FoldSummary[]>('folds.list')), [core]);
  useEffect(() => void load().catch(() => setError(t('folds.error.generic'))), [load, t]);
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
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t('page.folds.title')}</h1>
      <p className="mt-3 text-muted">{t('folds.lede')}</p>

      <h2 className="mt-6 text-lg font-semibold">{t('folds.list.label')}</h2>
      {folds.length === 0 ? <p className="mt-2 text-muted">{t('folds.empty')}</p> : null}
      <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong" aria-label={t('folds.list.label')}>
        {folds.map((fold) => (
          <li key={fold.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            {renaming?.id === fold.id ? (
              <form onSubmit={saveRename} className="flex flex-wrap items-end gap-2">
                <TextField label={t('folds.name.label')} value={renaming.name} onChange={(e) => setRenaming({ id: fold.id, name: e.target.value })} autoFocus />
                <button type="submit" className={buttonClass}>{t('folds.rename.save')}</button>
                <button type="button" className={secondaryButtonClass} onClick={() => setRenaming(undefined)}>{t('folds.rename.cancel')}</button>
              </form>
            ) : (
              <>
                <div>
                  <strong data-testid="fold-name">{fold.name}</strong>
                  <span className="ms-3 text-sm text-muted">{t(`folds.role.${fold.role}`)} · {t('folds.currency', { currency: fold.baseCurrency })}</span>
                </div>
                {fold.role === 'owner' ? (
                  <div className="flex gap-2">
                    <button type="button" className={secondaryButtonClass} onClick={() => setRenaming({ id: fold.id, name: fold.name })} aria-label={`${t('folds.rename')} ${fold.name}`}>{t('folds.rename')}</button>
                    <button type="button" className={secondaryButtonClass} onClick={() => void askDelete(fold)} aria-label={`${t('folds.delete')} ${fold.name}`}>{t('folds.delete')}</button>
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
          <select id="fold-currency" className="mt-1 block rounded-ui border border-border-strong bg-bg px-3 py-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <button type="submit" className={`${buttonClass} mt-4`}>{t('folds.create.submit')}</button>
      </form>

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
              {deleting.summary.isLastFold ? null : <button type="submit" className={buttonClass}>{t('folds.delete.confirm')}</button>}
              <button type="button" className={secondaryButtonClass} onClick={() => setDeleting(undefined)}>{t('folds.delete.cancel')}</button>
            </div>
          </form>
        ) : null}
      </dialog>
    </main>
  );
}
