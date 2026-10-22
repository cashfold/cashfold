'use client';

import type { PublicKeyBundle } from '@cashfold/core';
import { useState, type FormEvent } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { Fingerprint } from './Fingerprint';
import { sharingError } from './errors';
import { Button, Checkbox, CheckboxField, Label, Radio, RadioField, RadioGroup, Select } from '../kit';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
interface BundleView { bundle: PublicKeyBundle; fingerprint: string[]; fingerprintQr: string }

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
          <RadioGroup value={how} onChange={(v) => { setHow(v as typeof how); setQuery(''); }} aria-label={t('sharing.invite.how')} className="mt-2">
            <RadioField><Radio value="email" /><Label>{t('sharing.invite.byEmail')}</Label></RadioField>
            <RadioField><Radio value="code" /><Label>{t('sharing.invite.byCode')}</Label></RadioField>
          </RadioGroup>
        </fieldset>
        <TextField
          label={how === 'email' ? t('sharing.invite.email') : t('sharing.invite.code')} value={query} onChange={(e) => setQuery(e.target.value)} required autoFocus
          type={how === 'email' ? 'email' : 'text'} autoComplete="off" hint={how === 'email' ? t('sharing.invite.email.hint') : t('sharing.invite.code.hint')} error={error}
        />
        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={busy}>{t('sharing.invite.find')}</Button>
          <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
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
      <CheckboxField className="mt-3"><Checkbox checked={confirmed || typedMatches} onChange={(checked) => setConfirmed(checked)} disabled={typedMatches} /><Label>{t('sharing.invite.confirm')}</Label></CheckboxField>

      <div className="mt-4">
        <label htmlFor="inv-role" className="block font-medium">{t('sharing.invite.role')}</label>
        <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
          <option value="editor">{t('sharing.role.editor.long')}</option>
          <option value="viewer">{t('sharing.role.viewer.long')}</option>
        </Select>
      </div>
      <fieldset className="mt-4">
        <legend className="font-medium">{t('sharing.invite.scope')}</legend>
        <RadioGroup value={scope} onChange={(v) => setScope(v as typeof scope)} aria-label={t('sharing.invite.scope')} className="mt-2">
          <RadioField><Radio value="from_join" /><Label>{t('sharing.scope.from_join')}</Label></RadioField>
          <RadioField><Radio value="full" /><Label>{t('sharing.scope.full')}</Label></RadioField>
        </RadioGroup>
        <p className="mt-1 text-sm text-muted">{t('sharing.invite.scope.hint')}</p>
      </fieldset>

      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={busy || !(confirmed || typedMatches)}>{t('sharing.invite.send')}</Button>
        <Button outline type="button" onClick={() => { setFound(undefined); setTyped(''); }}>{t('sharing.invite.back')}</Button>
      </div>
    </form>
  );
}
