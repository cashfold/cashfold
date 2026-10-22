'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import type { FoldSummary } from '@cashfold/core';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { accountErrorText, type Reply } from '../settings/errors';
import { Button, Select } from '../kit';


/** Encrypted backup of one Fold, and restoring one into a new Fold (FR-091). The file is useless without its passphrase. */
export function BackupPanel({ folds }: { folds: readonly FoldSummary[] }) {
  const { t } = useI18n();
  const core = useCore();
  const [fold, setFold] = useState(folds[0]?.id ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [made, setMade] = useState(false);
  const [restoreSecret, setRestoreSecret] = useState('');
  const [restoreError, setRestoreError] = useState<string | undefined>();
  const [restored, setRestored] = useState<{ name: string; records: number } | undefined>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setMade(false);
    if (passphrase !== again) return setError(t('data.backup.mismatch'));
    setBusy(true);
    try {
      const result = await withPasswordBytes(passphrase, (bytes) => core.call<Reply<{ file: Uint8Array }>>('backup.create', { fold: fold || folds[0]?.id, passphrase: bytes }));
      if (!result.ok) return setError(accountErrorText(t, result.error));
      const name = folds.find((f) => f.id === (fold || folds[0]?.id))?.name ?? 'cashfold';
      const url = URL.createObjectURL(new Blob([result.value.file as BlobPart], { type: 'application/octet-stream' }));
      Object.assign(document.createElement('a'), { href: url, download: `${name}.cashfold-backup` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPassphrase('');
      setAgain('');
      setMade(true);
    } finally {
      setBusy(false);
    }
  }

  async function restore(event: FormEvent) {
    event.preventDefault();
    setRestoreError(undefined);
    setRestored(undefined);
    const chosen = file.current?.files?.[0];
    if (chosen === undefined) return setRestoreError(t('data.restore.nofile'));
    setBusy(true);
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const result = await withPasswordBytes(restoreSecret, (secret) => core.call<Reply<{ fold: FoldSummary; records: number }>>('backup.restore', { file: bytes, passphrase: secret }));
      if (!result.ok) return setRestoreError(accountErrorText(t, result.error));
      setRestored({ name: result.value.fold.name, records: result.value.records });
      setRestoreSecret('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="backup-heading" className="mt-8">
      <h2 id="backup-heading" className="text-lg font-semibold">{t('data.backup.title')}</h2>
      <p className="mt-1 text-muted">{t('data.backup.lede')}</p>
      <form onSubmit={create} aria-busy={busy} className="max-w-md">
        {folds.length > 1 ? (
          <label className="mt-4 block">
            <span className="block font-medium">{t('ledger.fold.label')}</span>
            <Select value={fold} onChange={(e) => setFold(e.target.value)}>{folds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
          </label>
        ) : null}
        <TextField label={t('data.backup.passphrase')} hint={t('data.backup.passphrase.hint')} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required />
        <TextField label={t('data.backup.again')} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <Button className="mt-4" type="submit" disabled={busy}>{t('data.backup.create')}</Button>
        {made ? <p role="status" className="mt-3">{t('data.backup.made')}</p> : null}
      </form>

      <h3 className="mt-8 font-semibold">{t('data.restore.title')}</h3>
      <p className="mt-1 text-muted">{t('data.restore.lede')}</p>
      <form onSubmit={restore} aria-busy={busy} className="max-w-md">
        <div className="mt-4">
          <label htmlFor="restore-file" className="block font-medium">{t('data.restore.file')}</label>
          <input id="restore-file" ref={file} type="file" className="mt-1 block w-full max-w-full" />
        </div>
        <TextField label={t('data.backup.passphrase')} type="password" autoComplete="off" value={restoreSecret} onChange={(e) => setRestoreSecret(e.target.value)} required />
        {restoreError ? <p role="alert" className="mt-3 text-danger">{restoreError}</p> : null}
        <Button className="mt-4" type="submit" disabled={busy}>{t('data.restore.submit')}</Button>
      </form>
      {restored ? (
        <p role="status" className="mt-3" data-testid="restored">
          {t('data.restore.done', { name: restored.name, count: restored.records })} <Link className="underline" href="/settings/folds/">{t('data.restore.goFolds')}</Link>
        </p>
      ) : null}
    </section>
  );
}
