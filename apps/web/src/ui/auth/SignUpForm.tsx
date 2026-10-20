'use client';

import { estimateStrength } from '@cashfold/core';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { TextField, buttonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { ServerAddress } from '../settings/ServerAddress';
import { SecretKeyScreen, type CreatedAccount } from './SecretKeyScreen';

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
  const [discoverable, setDiscoverable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'password' | 'confirm' | 'server' | 'form', string>>>({});
  const [created, setCreated] = useState<{ account: CreatedAccount; email: string; server: string } | undefined>();

  const strength = estimateStrength(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setErrors({ confirm: t('signup.error.mismatch') });
    setBusy(true);
    setErrors({});
    try {
      const result = await withPasswordBytes(password, (bytes) => core.call<CreateResult>('createAccount', { email, password: bytes, server, discoverable }));
      if (result.ok) {
        setPassword('');
        setConfirm('');
        setCreated({ account: result.value, email, server });
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
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t('page.signUp.title')}</h1>
      <p className="mt-3 text-muted">{t('signup.lede')}</p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <TextField label={t('signup.email.label')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
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
        <ServerAddress value={server} onChange={setServer} error={errors.server} />
        <div className="mt-4">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} />
            <span>{t('signup.discoverable.label')}<span className="block text-sm text-muted">{t('signup.discoverable.hint')}</span></span>
          </label>
        </div>
        {errors.form ? <p role="alert" className="mt-4 text-danger">{errors.form}</p> : null}
        <button type="submit" className={`${buttonClass} mt-6`} disabled={busy}>{busy ? t('signup.working') : t('signup.submit')}</button>
      </form>
    </main>
  );
}
