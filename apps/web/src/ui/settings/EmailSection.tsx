'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

type State = { verification: { kind: 'verified' | 'unverified' | 'disabled' }; discoverable: boolean };
type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string } };

const ERROR_KEYS: Readonly<Record<string, string>> = {
  offline: 'adddevice.error.offline',
  rate_limited: 'adddevice.error.rate_limited',
  invalid_token: 'email.error.invalid_token',
  disabled: 'email.disabled',
  already_verified: 'email.verified',
};

/** Email confirmation and discoverability (FR-105, FR-106). */
export function EmailSection() {
  const { t } = useI18n();
  const core = useCore();
  const [state, setState] = useState<State | undefined>();
  const [token, setToken] = useState('');
  const [message, setMessage] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const r = await core.call<Reply<State>>('email.status');
      if (r.ok) setState(r.value);
      else setMessage(t(ERROR_KEYS[r.error.code] ?? 'email.error.generic'));
    } catch {
      setMessage(t('email.error.generic'));
    }
  }, [core, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function request() {
    const r = await core.call<Reply<true>>('email.request');
    setMessage(r.ok ? t('email.sent') : t(ERROR_KEYS[r.error.code] ?? 'email.error.generic'));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const r = await core.call<Reply<true>>('email.submit', { token });
    if (r.ok) {
      setToken('');
      setMessage(t('email.verified'));
      await load();
    } else setMessage(t(ERROR_KEYS[r.error.code] ?? 'email.error.generic'));
  }

  async function setDiscoverable(discoverable: boolean) {
    const r = await core.call<Reply<true>>('email.setDiscoverable', { discoverable });
    if (r.ok) setState((s) => (s ? { ...s, discoverable } : s));
    else setMessage(t(ERROR_KEYS[r.error.code] ?? 'email.error.generic'));
  }

  if (state === undefined) return message ? <p role="status" className="mt-3">{message}</p> : null;
  return (
    <div className="mt-4 max-w-md">
      <h3 className="font-semibold">{t('email.title')}</h3>
      {state.verification.kind === 'verified' ? <p className="mt-1">{t('email.verified')}</p> : null}
      {state.verification.kind === 'disabled' ? <p className="mt-1">{t('email.disabled')}</p> : null}
      {state.verification.kind === 'unverified' ? (
        <div className="mt-1">
          <p className="text-muted">{t('email.unverified')}</p>
          <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={() => void request()}>{t('email.send')}</button>
          <form onSubmit={submit}>
            <TextField label={t('email.code.label')} hint={t('email.code.hint')} autoComplete="one-time-code" required value={token} onChange={(e) => setToken(e.target.value)} />
            <button type="submit" className={`${buttonClass} mt-3`}>{t('email.confirm')}</button>
          </form>
        </div>
      ) : null}
      <label className="mt-4 flex items-start gap-2">
        <input type="checkbox" checked={state.discoverable} onChange={(e) => void setDiscoverable(e.target.checked)} />
        <span>{t('email.discoverable')}</span>
      </label>
      <p role="status" className="mt-2 text-sm text-muted">{message ?? ''}</p>
    </div>
  );
}
