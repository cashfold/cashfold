'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { accountErrorText, type Reply } from './errors';
import { Button, Checkbox, CheckboxField, Label } from '../kit';

interface Moved { server: string; folds: number; kept: string[]; otherDevices: number; oldDeleted: boolean }
type DeleteReply = Reply<true> | { ok: false; error: { code: 'owns_shared_fold'; folds?: Array<{ id: string; name: string }> } };

/** Moving the account to another service (FR-100), and deleting it (FR-101). */
export function AccountSection() {
  const { t } = useI18n();
  const core = useCore();
  const [open, setOpen] = useState<'move' | 'delete' | undefined>();
  if (core.account?.registration !== 'done') return null;
  return (
    <section aria-labelledby="danger-heading" className="mt-8">
      <h2 id="danger-heading" className="text-lg font-semibold">{t('account.manage.title')}</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button outline type="button" aria-expanded={open === 'move'} onClick={() => setOpen(open === 'move' ? undefined : 'move')}>{t('account.move.open')}</Button>
        <Button outline type="button" aria-expanded={open === 'delete'} onClick={() => setOpen(open === 'delete' ? undefined : 'delete')}>{t('account.delete.open')}</Button>
      </div>
      {open === 'move' ? <MoveForm /> : null}
      {open === 'delete' ? <DeleteForm /> : null}
    </section>
  );
}

function MoveForm() {
  const { t } = useI18n();
  const core = useCore();
  const [server, setServer] = useState('');
  const [invite, setInvite] = useState('');
  const [password, setPassword] = useState('');
  const [deleteOld, setDeleteOld] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [moved, setMoved] = useState<Moved | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const result = await withPasswordBytes(password, (bytes) =>
        core.call<Reply<Moved>>('account.migrate', { password: bytes, server, ...(invite !== '' && { inviteCode: invite }), deleteOld }),
      );
      setPassword('');
      if (result.ok) setMoved(result.value);
      else setError(accountErrorText(t, result.error));
    } finally {
      setBusy(false);
    }
  }

  if (moved !== undefined) {
    return (
      <div role="status" className="mt-4 max-w-md" data-testid="moved">
        <p className="font-medium">{t('account.move.done', { server: moved.server, count: moved.folds })}</p>
        {moved.kept.length > 0 ? <p className="mt-2">{t('account.move.kept', { count: moved.kept.length })}</p> : null}
        {moved.otherDevices > 0 ? <p className="mt-2">{t('account.move.devices', { count: moved.otherDevices })}</p> : null}
        <p className="mt-2 text-muted">{moved.oldDeleted ? t('account.move.oldDeleted') : t('account.move.oldKept')}</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} aria-busy={busy} className="mt-4 max-w-md">
      <p className="text-muted">{t('account.move.lede')}</p>
      <TextField label={t('account.move.server')} type="url" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://" required autoComplete="off" />
      <TextField label={t('account.move.invite')} value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" />
      <TextField label={t('account.credentials.current')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <CheckboxField className="mt-4"><Checkbox checked={deleteOld} onChange={(checked) => setDeleteOld(checked)} /><Label>{t('account.move.deleteOld')}</Label></CheckboxField>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <Button className="mt-4" type="submit" disabled={busy}>{t('account.move.submit')}</Button>
    </form>
  );
}

function DeleteForm() {
  const { t } = useI18n();
  const core = useCore();
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [owned, setOwned] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const email = core.account?.email ?? '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setOwned([]);
    setBusy(true);
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<DeleteReply>('account.delete', { password: bytes }));
      setPassword('');
      if (result.ok) return; // the worker has erased this device and locked; the page follows
      if (result.error.code === 'owns_shared_fold') setOwned('folds' in result.error && result.error.folds !== undefined ? result.error.folds : []);
      setError(accountErrorText(t, result.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={busy} className="mt-4 max-w-md">
      <p className="font-medium text-danger">{t('account.delete.warning')}</p>
      <p className="mt-2 text-muted">{t('account.delete.lede')}</p>
      <TextField label={t('account.delete.type', { email })} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      <TextField label={t('account.credentials.current')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      {owned.length > 0 ? (
        <ul className="mt-2 list-disc ps-6" data-testid="owned-folds">
          {owned.map((f) => <li key={f.id}>{f.name}</li>)}
        </ul>
      ) : null}
      {owned.length > 0 ? <p className="mt-2"><Link className="underline" href="/settings/folds/">{t('account.delete.goFolds')}</Link></p> : null}
      <Button className="mt-4" type="submit" disabled={busy || typed.trim().toLowerCase() !== email.toLowerCase()}>{t('account.delete.submit')}</Button>
    </form>
  );
}
