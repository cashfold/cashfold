'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useCore, withPasswordBytes } from '../core/CoreProvider';
import { downloadKit, printKit } from '../emergency-kit/actions';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { OneTimeSecret } from '../settings/OneTimeSecret';
import { ServerAddress } from '../settings/ServerAddress';
import { accountErrorText, type Reply } from '../settings/errors';
import { Button } from '../kit';

/**
 * Getting back into an account with its Recovery Key (FR-009), when the password or the Secret Key is lost. A new password and a
 * new Secret Key replace the old ones, so the Secret Key is shown once before the person goes on.
 */
export function RecoverScreen() {
  const { t } = useI18n();
  const core = useCore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [server, setServer] = useState(process.env['NEXT_PUBLIC_DEFAULT_SERVER'] ?? '');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<{ text: string; accountId: string } | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (password !== again) return setError(t('account.credentials.mismatch'));
    setBusy(true);
    try {
      const result = await withPasswordBytes(password, (bytes) =>
        core.call<Reply<{ accountId: string; secretKeyText: string }>>('account.recover', { email, server, recoveryKeyText: recoveryKey, newPassword: bytes }),
      );
      setPassword('');
      setAgain('');
      if (!result.ok) return setError(accountErrorText(t, result.error));
      setRecoveryKey('');
      setNewKey({ text: result.value.secretKeyText, accountId: result.value.accountId });
    } catch {
      setError(t('account.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (newKey !== undefined) {
    const kit = { accountId: newKey.accountId, email: email.trim().toLowerCase(), server, secretKeyText: newKey.text };
    return (
      <div>
        <h1 className="text-2xl font-semibold">{t('page.recover.title')}</h1>
        <p className="mt-3" role="status">{t('recover.done')}</p>
        <OneTimeSecret
          title={t('account.newkey.title')} lede={t('account.newkey.lede')} warning={t('account.newkey.warning')} label={t('secretkey.label')} text={newKey.text} testId="new-secret-key"
          fileName="cashfold-secret-key.txt"
          extra={(
            <>
              <Button outline type="button" onClick={() => downloadKit(kit)}>{t('secretkey.download')}</Button>
              <Button outline type="button" onClick={() => printKit(kit)}>{t('secretkey.print')}</Button>
            </>
          )}
          onDone={() => void core.markUnlocked().then(() => router.replace('/overview/'))}
        />
      </div>
    );
  }

  if (core.phase === 'locked' || core.phase === 'unlocked') {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{t('page.recover.title')}</h1>
        <p className="mt-3">{t('adddevice.alreadyHasAccount')}</p>
        <p className="mt-3"><Link className="underline" href="/settings/">{t('recover.goSettings')}</Link></p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('page.recover.title')}</h1>
      <p className="mt-3 text-muted">{t('recover.lede')}</p>
      <form onSubmit={submit} aria-busy={busy}>
        <TextField label={t('signup.email.label')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <ServerAddress value={server} onChange={setServer} />
        <TextField label={t('recover.key.label')} hint={t('recover.key.hint')} autoComplete="off" required spellCheck={false} value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} />
        <TextField label={t('account.credentials.new')} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label={t('account.credentials.again')} type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
        {error ? <p role="alert" className="mt-4 text-danger">{error}</p> : null}
        <Button className="mt-6" type="submit" disabled={busy}>{busy ? t('adddevice.working') : t('recover.submit')}</Button>
      </form>
      <p className="mt-6"><Link className="underline" href="/add/">{t('recover.back')}</Link></p>
    </div>
  );
}
