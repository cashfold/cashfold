'use client';

import { useState, type FormEvent } from 'react';
import { InputField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { parseRateText } from '../ledger/format';
import { useLedger } from '../ledger/LedgerProvider';

/** Asked inline when a saved amount needs an exchange rate that is not known yet; the other values of the form are kept (US1 scenario 6). */
export function RatePrompt({ currency, asOfUtcS, formId, onSaved }: { currency: string; asOfUtcS: number; formId: string; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();

  async function save(event: FormEvent) {
    event.preventDefault();
    const rate = parseRateText(text, locale);
    if (!rate.ok) return setError(t(`ledger.rate.${rate.error.code}`));
    const r = await ledger.run('ledger.setCustomRate', { quote: currency, asOfUtcS, rateE12: rate.value });
    if (!r.ok) return setError(ledger.explain(r.error.code));
    onSaved();
  }

  return (
    <form id={formId} onSubmit={save} className="space-y-4">
      <p>{t('ledger.rate.explain', { currency })}</p>
      <InputField label={t('ledger.rate.label', { currency })} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoComplete="off" autoFocus hint={t('ledger.rate.hint')} error={error} />
    </form>
  );
}
