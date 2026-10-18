'use client';

import { useState } from 'react';
import { buildEmergencyKitHtml, copyWithAutoClear } from '../emergency-kit/kit';
import { buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

export interface CreatedAccount {
  readonly secretKeyText: string;
  readonly accountId: string;
  readonly registration: 'pending' | 'done';
}

function kitFor(created: CreatedAccount, email: string, server: string) {
  const html = buildEmergencyKitHtml({ accountId: created.accountId, email, server, secretKeyText: created.secretKeyText, generatedOn: new Date().toISOString().slice(0, 10) }, location.origin);
  return html;
}

/** Shown once, right after sign-up (FR-002, FR-003). Leaving it drops the Secret Key from the page. */
export function SecretKeyScreen({ created, email, server, onDone }: { created: CreatedAccount; email: string; server: string; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  function download() {
    const url = URL.createObjectURL(new Blob([kitFor(created, email, server)], { type: 'text/html' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'cashfold-emergency-kit.html' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function print() {
    const frame = Object.assign(document.createElement('iframe'), { hidden: true, srcdoc: kitFor(created, email, server) });
    frame.onload = () => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    };
    document.body.append(frame);
  }

  return (
    <main id="main" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">{t('secretkey.title')}</h1>
      <p className="mt-3">{t('secretkey.lede')}</p>
      <p className="mt-3 font-medium text-danger" role="note">{t('secretkey.warning')}</p>
      <p className="mt-6 text-sm text-muted">{t('secretkey.label')}</p>
      <p className="mt-1 break-all rounded-ui border border-border-strong bg-surface p-4 font-mono text-xl tracking-wide" data-testid="secret-key" dir="ltr">{created.secretKeyText}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className={secondaryButtonClass} onClick={async () => setCopy((await copyWithAutoClear(created.secretKeyText, 60_000)) ? 'copied' : 'failed')}>{t('secretkey.copy')}</button>
        <button type="button" className={secondaryButtonClass} onClick={download}>{t('secretkey.download')}</button>
        <button type="button" className={secondaryButtonClass} onClick={print}>{t('secretkey.print')}</button>
      </div>
      <p className="mt-2 text-sm" role="status">{copy === 'copied' ? t('secretkey.copied') : copy === 'failed' ? t('secretkey.copyFailed') : ''}</p>
      {created.registration === 'pending' ? <p className="mt-4 text-muted">{t('secretkey.pending')}</p> : null}
      <label className="mt-6 flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t('secretkey.confirm')}</span>
      </label>
      <button type="button" className={`${buttonClass} mt-4`} disabled={!saved} onClick={() => void onDone()}>{t('secretkey.continue')}</button>
    </main>
  );
}
