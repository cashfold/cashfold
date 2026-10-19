'use client';

import type { PublicKeyBundle } from '@cashfold/core';
import { useState, type FormEvent } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { Fingerprint } from './Fingerprint';
import { sharingError } from './errors';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
interface BundleView { bundle: PublicKeyBundle; fingerprint: string[]; fingerprintQr: string }
const select = 'mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2';

/** Digits only, so "12345 67890" and "1234567890" compare alike. */
const digits = (text: string): string => text.replace(/\D/g, '');

/**
 * Inviting someone (FR-083, FR-084, FR-102): find their keys by the address they allow or by the code they gave you, compare their
 * fingerprint with them (mandatory), choose their role and how much history they see, and send.
 */
export function InviteForm({ fold, onDone }: { fold: string; onDone: () => void }) {
  const { t } = useI18n();
  const core = useCore();
  const [how, setHow] = useState<'email' | 'code'>('email');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<BundleView | undefined>();
  const [typed, setTyped] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [scope, setScope] = useState<'full' | 'from_join'>('from_join');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setFound(undefined);
    setConfirmed(false);
    setBusy(true);
    try {
      const result = how === 'email'
        ? await core.call<Outcome<BundleView>>('sharing.lookupEmail', { email: query })
        : await core.call<Outcome<BundleView>>('sharing.lookupCode', { code: query });
      if (result.ok) {
        setFound(result.value);
        if (how === 'email') setEmail(query.trim());
      } else setError(t(sharingError(result.error.code, how === 'email' ? 'lookup' : 'code')));
    } finally {
      setBusy(false);
    }
  }

  // Typing or pasting what the other person reads out confirms it; ticking the box does too, for people who compared side by side.
  const typedMatches = found !== undefined && digits(typed) === found.fingerprint.join('');

  async function send(event: FormEvent) {
    event.preventDefault();
    if (found === undefined) return;
    setError(undefined);
    setBusy(true);
    try {
      const result = await core.call<Outcome<unknown>>('sharing.invite', {
        fold, bundle: found.bundle, role: role === 'editor' ? 2 : 3, scope, fingerprintConfirmed: confirmed || typedMatches, ...(how === 'email' && email !== '' && { notifyEmail: email }),
      });
      if (result.ok) onDone();
      else setError(t(sharingError(result.error.code, 'invite')));
    } finally {
      setBusy(false);
    }
  }

  if (found === undefined) {
    return (
      <form onSubmit={lookup} aria-busy={busy}>
        <fieldset>
          <legend className="font-medium">{t('sharing.invite.how')}</legend>
          <label className="me-4 mt-2 inline-flex items-center gap-2"><input type="radio" name="how" checked={how === 'email'} onChange={() => { setHow('email'); setQuery(''); }} />{t('sharing.invite.byEmail')}</label>
          <label className="mt-2 inline-flex items-center gap-2"><input type="radio" name="how" checked={how === 'code'} onChange={() => { setHow('code'); setQuery(''); }} />{t('sharing.invite.byCode')}</label>
        </fieldset>
        <TextField
          label={how === 'email' ? t('sharing.invite.email') : t('sharing.invite.code')} value={query} onChange={(e) => setQuery(e.target.value)} required autoFocus
          type={how === 'email' ? 'email' : 'text'} autoComplete="off" hint={how === 'email' ? t('sharing.invite.email.hint') : t('sharing.invite.code.hint')} error={error}
        />
        <div className="mt-6 flex gap-3">
          <button type="submit" className={buttonClass} disabled={busy}>{t('sharing.invite.find')}</button>
          <button type="button" className={secondaryButtonClass} onClick={onDone}>{t('ledger.cancel')}</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={send} aria-busy={busy}>
      <p className="mt-3">{t('sharing.invite.found', { account: found.bundle.accountId })}</p>
      <h3 className="mt-4 font-medium">{t('sharing.invite.compare')}</h3>
      <p className="text-sm text-muted">{t('sharing.invite.compare.hint')}</p>
      <div className="mt-2">
        <Fingerprint groups={found.fingerprint} qr={found.fingerprintQr} label={t('sharing.invite.theirs')} testId="their-fingerprint" />
      </div>
      <TextField label={t('sharing.invite.typed')} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" inputMode="numeric" hint={typed === '' ? t('sharing.invite.typed.hint') : typedMatches ? t('sharing.invite.typed.match') : t('sharing.invite.typed.differ')} />
      <label className="mt-3 flex items-start gap-2">
        <input type="checkbox" checked={confirmed || typedMatches} onChange={(e) => setConfirmed(e.target.checked)} disabled={typedMatches} className="mt-1" />
        <span>{t('sharing.invite.confirm')}</span>
      </label>

      <div className="mt-4">
        <label htmlFor="inv-role" className="block font-medium">{t('sharing.invite.role')}</label>
        <select id="inv-role" className={select} value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
          <option value="editor">{t('sharing.role.editor.long')}</option>
          <option value="viewer">{t('sharing.role.viewer.long')}</option>
        </select>
      </div>
      <fieldset className="mt-4">
        <legend className="font-medium">{t('sharing.invite.scope')}</legend>
        <label className="mt-2 flex items-start gap-2"><input type="radio" name="scope" className="mt-1" checked={scope === 'from_join'} onChange={() => setScope('from_join')} /><span>{t('sharing.scope.from_join')}</span></label>
        <label className="mt-2 flex items-start gap-2"><input type="radio" name="scope" className="mt-1" checked={scope === 'full'} onChange={() => setScope('full')} /><span>{t('sharing.scope.full')}</span></label>
        <p className="mt-1 text-sm text-muted">{t('sharing.invite.scope.hint')}</p>
      </fieldset>

      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="submit" className={buttonClass} disabled={busy || !(confirmed || typedMatches)}>{t('sharing.invite.send')}</button>
        <button type="button" className={secondaryButtonClass} onClick={() => { setFound(undefined); setTyped(''); }}>{t('sharing.invite.back')}</button>
      </div>
    </form>
  );
}
