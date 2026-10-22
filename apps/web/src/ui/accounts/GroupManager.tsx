'use client';

import { useState, type FormEvent } from 'react';
import { InputField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../kit';
import { useLedger } from '../ledger/LedgerProvider';

export function GroupManager() {
  const { t } = useI18n();
  const ledger = useLedger();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const groups = ledger.basics?.groups ?? [];

  async function create(event: FormEvent) {
    event.preventDefault();
    const r = await ledger.run('ledger.createGroup', { name });
    if (r.ok) {
      setName('');
      setError(undefined);
    } else setError(ledger.explain(r.error.code));
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const r = await ledger.run('ledger.updateGroup', { id: renaming.id, name: renaming.name });
    if (r.ok) setRenaming(undefined);
    else setError(ledger.explain(r.error.code));
  }

  return (
    <details className="mt-8">
      <summary className="cursor-pointer text-lg font-semibold">{t('ledger.groups.title')}</summary>
      <p className="mt-2 text-muted">{t('ledger.groups.lede')}</p>
      <ul className="mt-2" aria-label={t('ledger.groups.title')}>
        {groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-2 py-1">
            {renaming?.id === g.id ? (
              <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
                <InputField label={t('ledger.groups.name')} value={renaming.name} onChange={(e) => setRenaming({ id: g.id, name: e.target.value })} autoFocus />
                <Button type="submit">{t('ledger.save')}</Button>
                <Button type="button" outline onClick={() => setRenaming(undefined)}>{t('ledger.cancel')}</Button>
              </form>
            ) : (
              <>
                <span>{g.name}</span>
                <Button type="button" outline onClick={() => setRenaming({ id: g.id, name: g.name })} aria-label={`${t('ledger.edit')} ${g.name}`}>{t('ledger.edit')}</Button>
                <Button type="button" outline onClick={() => void ledger.run('ledger.deleteGroup', { id: g.id })} aria-label={`${t('ledger.delete')} ${g.name}`}>{t('ledger.delete')}</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="max-w-md">
        <InputField label={t('ledger.groups.new')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
        <Button type="submit" className="mt-3">{t('ledger.groups.create')}</Button>
      </form>
    </details>
  );
}
