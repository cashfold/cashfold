'use client';

import { useState, type ReactNode } from 'react';
import { copyWithAutoClear } from '../emergency-kit/kit';
import { buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';

/** Saves text as a file the person keeps. */
export function downloadText(name: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A secret shown once (a Recovery Key, a new Secret Key). It is on the page only until the person says they have kept it, and then it
 * is gone: nothing here can show it again.
 */
export function OneTimeSecret(props: { title: string; lede: string; warning: string; label: string; text: string; testId: string; fileName: string; extra?: ReactNode; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <section aria-labelledby="secret-heading" className="mt-4 rounded-ui border border-border-strong p-4">
      <h3 id="secret-heading" className="font-semibold">{props.title}</h3>
      <p className="mt-2">{props.lede}</p>
      <p className="mt-2 font-medium text-danger" role="note">{props.warning}</p>
      <p className="mt-4 text-sm text-muted">{props.label}</p>
      <p className="mt-1 break-all rounded-ui border border-border-strong bg-surface p-4 font-mono text-lg tracking-wide" data-testid={props.testId} dir="ltr">{props.text}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={secondaryButtonClass} onClick={async () => setCopy((await copyWithAutoClear(props.text, 60_000)) ? 'copied' : 'failed')}>{t('secretkey.copy')}</button>
        <button type="button" className={secondaryButtonClass} onClick={() => downloadText(props.fileName, `${props.text}\n`)}>{t('account.secret.download')}</button>
        {props.extra}
      </div>
      <p className="mt-2 text-sm" role="status">{copy === 'copied' ? t('secretkey.copied') : copy === 'failed' ? t('secretkey.copyFailed') : ''}</p>
      <label className="mt-4 flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t('account.secret.confirm')}</span>
      </label>
      <button type="button" className={`${buttonClass} mt-3`} disabled={!saved} onClick={props.onDone}>{t('account.secret.done')}</button>
    </section>
  );
}
