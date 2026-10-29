'use client';

import { useState, type FormEvent } from 'react';
import type { FoldSummary } from '@cashfold/core';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { downloadText } from '../settings/OneTimeSecret';
import { accountErrorText, type Reply } from '../settings/errors';
import { Button, Select, SelectOption } from '../kit';


/** CSV export (FR-092). The file is plain text, so the warning comes first and the password is asked for again. */
export function CsvExportPanel({ folds }: { folds: readonly FoldSummary[] }) {
  const { t } = useI18n();
  const core = useCore();
  const [fold, setFold] = useState(folds[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setDone(false);
    setBusy(true);
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<Reply<{ text: string; name: string }>>('csv.export', { fold: fold || folds[0]?.id, password: bytes }));
      setPassword('');
      if (!result.ok) return setError(accountErrorText(t, result.error));
      downloadText(`${result.value.name}.csv`, result.value.text, 'text/csv');
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="export-heading" className="mt-8">
      <h2 id="export-heading" className="text-lg font-semibold">{t('data.export.title')}</h2>
      <p className="mt-1 font-medium text-danger" role="note">{t('data.export.warning')}</p>
      <form onSubmit={submit} aria-busy={busy} className="max-w-md">
        {folds.length > 1 ? (
          <label className="mt-4 block">
            <span className="mb-3 block font-medium">{t('ledger.fold.label')}</span>
            <Select value={fold} onChange={setFold}>{folds.map((f) => <SelectOption key={f.id} value={f.id}>{f.name}</SelectOption>)}</Select>
          </label>
        ) : null}
        <TextField label={t('account.credentials.current')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <Button className="mt-4" type="submit" disabled={busy}>{t('data.export.submit')}</Button>
        {done ? <p role="status" className="mt-3">{t('data.export.done')}</p> : null}
      </form>
    </section>
  );
}
