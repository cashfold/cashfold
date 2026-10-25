'use client';

import type { TransactionRow } from '@cashfold/core';
import { useState } from 'react';
import { useCore } from '../core/CoreProvider';

import type { Translate } from '../i18n/i18n';
import { useI18n } from '../i18n/I18nProvider';
import { useLedger } from './LedgerProvider';
import { Button } from '../kit';

export const MAX_ATTACHMENT_MB = 25;

/** Saves bytes as a file the person keeps. */
function save(name: string, mime: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const sizeText = (bytes: number, locale: string, t: Translate): string => {
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const tenths = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const size = BigInt(bytes);
  return size < 1024n * 1024n ? t('unit.kb', { value: whole.format(Number((size + 1023n) / 1024n)) }) : t('unit.mb', { value: tenths.format(Number((size * 10n) / (1024n * 1024n)) / 10) });
};

/** What the form needs to know once the person has chosen: a file to attach, or to take the current one off. */
export interface AttachmentChoice {
  readonly file: File | undefined;
  readonly remove: boolean;
}

/** The attachment of a transaction: what is there now, a way to open or remove it, and a way to choose another (FR-030, FR-093). */
export function AttachmentField({ existing, choice, onChange }: { existing?: TransactionRow; choice: AttachmentChoice; onChange: (next: AttachmentChoice) => void }) {
  const { t, locale } = useI18n();
  const core = useCore();
  const ledger = useLedger();
  const [error, setError] = useState<string | undefined>();
  const [opening, setOpening] = useState(false);
  const current = existing?.attachment ?? undefined;

  async function open() {
    if (existing === undefined || ledger.fold === undefined) return;
    setError(undefined);
    setOpening(true);
    try {
      const r = await core.call<{ ok: true; value: { name: string; mime: string; bytes: Uint8Array } } | { ok: false; error: { code: string } }>('attachments.open', { fold: ledger.fold.id, transaction: existing.id });
      if (r.ok) save(r.value.name, r.value.mime, r.value.bytes);
      else setError(t(`ledger.attachment.error.${r.error.code}`) === `ledger.attachment.error.${r.error.code}` ? t('ledger.attachment.error.generic') : t(`ledger.attachment.error.${r.error.code}`));
    } finally {
      setOpening(false);
    }
  }

  function pick(file: File | undefined) {
    setError(undefined);
    if (file !== undefined && file.size > MAX_ATTACHMENT_MB * 1024 * 1024) return setError(t('ledger.attachment.error.too_large', { mb: MAX_ATTACHMENT_MB }));
    onChange({ file, remove: choice.remove });
  }

  return (
    <fieldset className="mt-4">
      <legend className="font-medium">{t('ledger.attachment.title')}</legend>
      {current !== undefined && !choice.remove && choice.file === undefined ? (
        <p className="mt-1 flex flex-wrap items-center gap-3" data-testid="attachment-current">
          <span dir="auto">{current.name} <span className="text-muted">({sizeText(current.size, locale, t)})</span></span>
          <Button outline type="button" disabled={opening} aria-label={t('ledger.attachment.open.label', { name: current.name })} onClick={() => void open()}>{t('ledger.attachment.open')}</Button>
          <Button outline type="button" aria-label={t('ledger.attachment.remove.label', { name: current.name })} onClick={() => onChange({ file: undefined, remove: true })}>{t('ledger.attachment.remove')}</Button>
        </p>
      ) : null}
      {choice.remove && choice.file === undefined ? (
        <p className="mt-1 flex flex-wrap items-center gap-3">
          <span>{t('ledger.attachment.willRemove')}</span>
          <Button outline type="button" onClick={() => onChange({ file: undefined, remove: false })}>{t('ledger.attachment.keep')}</Button>
        </p>
      ) : null}
      <div className="mt-2">
        <label htmlFor="attachment-file" className="block text-sm text-muted">{current === undefined ? t('ledger.attachment.add') : t('ledger.attachment.replace')}</label>
        <input id="attachment-file" type="file" className="mt-1 block w-full max-w-full" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <p className="mt-1 text-sm text-muted">{t('ledger.attachment.hint', { mb: MAX_ATTACHMENT_MB })}</p>
      {error ? <p role="alert" className="mt-1 text-danger">{error}</p> : null}
    </fieldset>
  );
}
