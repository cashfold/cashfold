'use client';

import { estimateStrength } from '@cashfold/core';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { LanguagePicker } from '../i18n/LanguagePicker';
import { useI18n } from '../i18n/I18nProvider';
import { ServerAddress } from '../settings/ServerAddress';
import { starterCategoryNames, starterFoldName } from '../i18n/starter-names';
import { SecretKeyScreen, type CreatedAccount } from './SecretKeyScreen';
import { missingAddress, serverToSend, startsLocalOnly } from './sign-up-choice';
import { Button, Checkbox, CheckboxField, Label } from '../kit';

const DEFAULT_SERVER = process.env['NEXT_PUBLIC_DEFAULT_SERVER'] ?? '';

type CreateResult = { ok: true; value: CreatedAccount } | { ok: false; error: { code: string; violations?: string[] } };

export function SignUpForm() {
  const { t } = useI18n();
  const core = useCore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [server, setServer] = useState(DEFAULT_SERVER);
  // Spec 010: a build with no default service starts on keeping everything on this device; one with a default service starts as before.
  const [localOnly, setLocalOnly] = useState(startsLocalOnly(DEFAULT_SERVER));
  const [discoverable, setDiscoverable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'password' | 'confirm' | 'server' | 'form', string>>>({});
  const [created, setCreated] = useState<{ account: CreatedAccount; email: string; server: string } | undefined>();

  const strength = estimateStrength(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setErrors({ confirm: t('signup.error.mismatch') });
    if (missingAddress(localOnly, server)) return setErrors({ server: t('signup.error.invalid_server') });
    setBusy(true);
    setErrors({});
    const sent = serverToSend(localOnly, server);
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<CreateResult>('createAccount', { email, password: bytes, server: sent, ...(localOnly ? {} : { discoverable }), foldName: starterFoldName(t), categoryNames: starterCategoryNames(t) }));
      if (result.ok) {
        setPassword('');
        setConfirm('');
        setCreated({ account: result.value, email, server: sent });
        return;
      }
      const code = result.error.code;
      const message = t(`signup.error.${code}`) === `signup.error.${code}` ? t('signup.error.generic') : t(`signup.error.${code}`);
      if (code === 'invalid_email') setErrors({ email: message });
      else if (code === 'invalid_server') setErrors({ server: message });
      else if (code === 'weak_password') setErrors({ password: [message, ...(result.error.violations ?? []).map((v) => t(`password.feedback.${v}`))].join(' ') });
      else setErrors({ form: message });
    } catch {
      setErrors({ form: t('signup.error.generic') });
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <SecretKeyScreen
        created={created.account}
        email={created.email}
        server={created.server}
        onDone={async () => {
          setCreated(undefined); // drops the Secret Key from memory
          await core.markUnlocked();
          router.push('/overview/');
        }}
      />
    );
  }

  return (
    <div>
      {/* The one place before sign-in that offers the language; the Secret Key step that follows has none (spec 005). */}
      <div className="mb-4 flex justify-end"><LanguagePicker id="language-signup" className="max-w-56" /></div>
      <h1 className="text-2xl font-semibold">{t('page.signUp.title')}</h1>
      <p className="mt-3 text-muted">{t('signup.lede')}</p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <TextField label={t('signup.email.label')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} {...(localOnly ? { hint: t('signup.email.localHint') } : {})} />
        <TextField
          label={t('signup.password.label')} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          hint={t('signup.password.hint')} error={errors.password}
        />
        {password ? (
          <div className="mt-2" aria-live="polite">
            <label className="text-sm">
              {t('signup.strength.label')}: <strong>{t(`signup.strength.${strength.score}`)}</strong>
              <meter className="ms-2 align-middle" min={0} max={4} low={2} optimum={4} value={strength.score} />
            </label>
            <ul className="mt-1 list-disc ps-5 text-sm text-muted">
              {strength.feedback.map((key) => <li key={key}>{t(key)}</li>)}
            </ul>
          </div>
        ) : null}
        <TextField label={t('signup.confirm.label')} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <div className="mt-4">
          <CheckboxField><Checkbox checked={localOnly} onChange={(checked) => setLocalOnly(checked)} /><Label>{t('signup.local.label')}<span className="block text-sm text-muted">{t('signup.local.hint')}</span></Label></CheckboxField>
        </div>
        {localOnly ? null : (
          <>
            <ServerAddress value={server} onChange={setServer} error={errors.server} />
            <div className="mt-4">
              <CheckboxField><Checkbox checked={discoverable} onChange={(checked) => setDiscoverable(checked)} /><Label>{t('signup.discoverable.label')}<span className="block text-sm text-muted">{t('signup.discoverable.hint')}</span></Label></CheckboxField>
            </div>
          </>
        )}
        {errors.form ? <p role="alert" className="mt-4 text-danger">{errors.form}</p> : null}
        <Button className="mt-6" type="submit" disabled={busy}>{busy ? t('signup.working') : t('signup.submit')}</Button>
      </form>
    </div>
  );
}
