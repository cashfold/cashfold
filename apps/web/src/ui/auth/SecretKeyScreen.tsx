'use client';

import { useState } from 'react';
import { downloadKit, printKit } from '../emergency-kit/actions';
import { copyWithAutoClear } from '../emergency-kit/kit';

import { useI18n } from '../i18n/I18nProvider';
import { Button, Checkbox, CheckboxField, Label } from '../kit';

export interface CreatedAccount {
  readonly secretKeyText: string;
  readonly accountId: string;
  readonly registration: 'pending' | 'done';
}

/** Shown once, right after sign-up (FR-002, FR-003). Leaving it drops the Secret Key from the page. */
export function SecretKeyScreen({ created, email, server, onDone }: { created: CreatedAccount; email: string; server: string; onDone: () => Promise<void> }) {
  const { t, locale, dir } = useI18n();
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const kit = { accountId: created.accountId, email, server, secretKeyText: created.secretKeyText };

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('secretkey.title')}</h1>
      <p className="mt-3">{t('secretkey.lede')}</p>
      <p className="mt-3 font-medium text-danger" role="note">{t('secretkey.warning')}</p>
      <p className="mt-6 text-sm text-muted">{t('secretkey.label')}</p>
      <p className="mt-1 break-all rounded-ui border border-border-strong bg-surface p-4 font-mono text-xl tracking-wide" data-testid="secret-key" data-selectable dir="ltr">{created.secretKeyText}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button outline type="button" onClick={async () => setCopy((await copyWithAutoClear(created.secretKeyText, 60_000)) ? 'copied' : 'failed')}>{t('secretkey.copy')}</Button>
        <Button outline type="button" onClick={() => downloadKit(kit, { t, locale, dir })}>{t('secretkey.download')}</Button>
        <Button outline type="button" onClick={() => printKit(kit, { t, locale, dir })}>{t('secretkey.print')}</Button>
      </div>
      <p className="mt-2 text-sm" role="status">{copy === 'copied' ? t('secretkey.copied') : copy === 'failed' ? t('secretkey.copyFailed') : ''}</p>
      {created.registration === 'pending' ? <p className="mt-4 text-muted">{t('secretkey.pending')}</p> : null}
      <CheckboxField className="mt-6"><Checkbox checked={saved} onChange={(checked) => setSaved(checked)} /><Label>{t('secretkey.confirm')}</Label></CheckboxField>
      <Button className="mt-4" type="button" disabled={!saved} onClick={() => void onDone()}>{t('secretkey.continue')}</Button>
    </div>
  );
}
