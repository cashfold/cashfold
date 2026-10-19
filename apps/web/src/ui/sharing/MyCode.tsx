'use client';

import { useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { Fingerprint } from './Fingerprint';

interface MyCodeData { code: string; fingerprint: string[]; fingerprintQr: string }
type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string } };

/** What a person hands to whoever is inviting them: their fingerprint to compare, and an invitation code for people who cannot look them up (FR-106). */
export function MyCode() {
  const { t } = useI18n();
  const core = useCore();
  const [data, setData] = useState<MyCodeData | undefined>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void core.call<Outcome<MyCodeData>>('sharing.myCode').then((r) => live && r.ok && setData(r.value), () => undefined);
    return () => {
      live = false;
    };
  }, [core]);

  if (data === undefined) return null;
  return (
    <section className="mt-8" aria-labelledby="my-code-title">
      <h2 id="my-code-title" className="text-lg font-semibold">{t('sharing.mine.title')}</h2>
      <p className="mt-1 text-muted">{t('sharing.mine.lede')}</p>
      <h3 className="mt-3 font-medium">{t('sharing.mine.fingerprint')}</h3>
      <Fingerprint groups={data.fingerprint} qr={data.fingerprintQr} label={t('sharing.mine.fingerprint')} testId="my-fingerprint" />
      <h3 className="mt-4 font-medium">{t('sharing.mine.code')}</h3>
      <p className="mt-1 break-all rounded-ui border border-border-strong p-2 font-mono text-sm" data-testid="my-code">{data.code}</p>
      <button
        type="button" className={`${secondaryButtonClass} mt-2`}
        onClick={() => void navigator.clipboard?.writeText(data.code).then(() => setCopied(true), () => undefined)}
      >
        {copied ? t('sharing.mine.copied') : t('sharing.mine.copy')}
      </button>
    </section>
  );
}
