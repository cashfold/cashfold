'use client';

import { CURRENCY_EXPONENTS, type ExchangeRate } from '@cashfold/core';
import { useState, type FormEvent } from 'react';
import { TextField } from '../../forms/TextField';
import { useI18n } from '../../i18n/I18nProvider';
import { dateOfUtcSeconds, dateToInput, formatDate, inputToDate, localDateOfUtcSeconds, startOfLocalDayUtcS, todayLocal } from '../dates';
import { formatRate, parseRateText } from '../format';
import { useLedger } from '../LedgerProvider';
import { Button, Select, SelectOption } from '../../kit';

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS).filter((c) => c !== 'USD').sort();
/** Your own exchange rates, and the action that re-values past transactions with the rates known now. */
export function RateManager() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const rates: readonly ExchangeRate[] = ledger.basics!.rates;
  const [quote, setQuote] = useState(CURRENCIES.includes('EUR') ? 'EUR' : CURRENCIES[0]!);
  const [day, setDay] = useState(dateToInput(todayLocal()));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [summary, setSummary] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsedDay = inputToDate(day);
    const rate = parseRateText(text, locale);
    if (parsedDay === undefined) return setError(t('ledger.accounts.form.date'));
    if (!rate.ok) return setError(t(`ledger.rate.${rate.error.code}`));
    const r = await ledger.run('ledger.setCustomRate', { quote, asOfUtcS: startOfLocalDayUtcS(parsedDay), rateE12: rate.value });
    if (r.ok) {
      setText('');
      setError(undefined);
    } else setError(ledger.explain(r.error.code));
  }

  async function revalue() {
    setConfirming(false);
    const r = await ledger.run<{ revalued: number; unchanged: number; missingRates: Array<{ currency: string }> }>('ledger.revalueAll', {});
    if (!r.ok) return setError(ledger.explain(r.error.code));
    setSummary(t('ledger.rates.revalue.done', { revalued: r.value.revalued, unchanged: r.value.unchanged, missing: r.value.missingRates.length }));
  }

  return (
    <section className="mt-10" aria-labelledby="rates-title">
      <h2 id="rates-title" className="text-lg font-semibold">{t('ledger.rates.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('ledger.rates.lede')}</p>
      {rates.length === 0 ? <p className="mt-2 text-muted">{t('ledger.rates.empty')}</p> : null}
      <ul className="mt-2 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10 empty:hidden" aria-label={t('ledger.rates.title')} data-testid="rate-list">
        {[...rates].reverse().map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <span>
              <strong>{r.quote}</strong> {formatRate(r.rateE12, locale)} <span className="text-sm text-muted">{t('ledger.rates.per')}</span>
              <span className="ms-3 text-sm text-muted">{formatDate(r.source === 'custom' ? localDateOfUtcSeconds(r.asOfUtcS) : dateOfUtcSeconds(r.asOfUtcS), locale)} · {t(r.source === 'custom' ? 'ledger.rates.own' : 'ledger.rates.service')}</span>
            </span>
            {r.source === 'custom' ? (
              <Button outline type="button" onClick={() => void ledger.run('ledger.deleteCustomRate', { id: r.id })} aria-label={`${t('ledger.delete')} ${r.quote} ${formatRate(r.rateE12, locale)}`}>{t('ledger.delete')}</Button>
            ) : null}
          </li>
        ))}
      </ul>

      <form onSubmit={save} className="mt-4 grid max-w-xl gap-x-4 *:min-w-0 sm:grid-cols-3">
        <div className="mt-4">
          <label htmlFor="rate-quote" className="mb-3 block font-medium">{t('ledger.rates.currency')}</label>
          <Select id="rate-quote" value={quote} onChange={setQuote}>
            {CURRENCIES.map((c) => <SelectOption key={c} value={c}>{c}</SelectOption>)}
          </Select>
        </div>
        <TextField label={t('ledger.rates.rate', { currency: quote })} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoComplete="off" required />
        <TextField label={t('ledger.rates.date')} type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        <div className="sm:col-span-3">
          {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
          <Button className="mt-3" type="submit" >{t('ledger.rates.save')}</Button>
        </div>
      </form>

      <div className="mt-6">
        <h3 className="font-semibold">{t('ledger.rates.revalue.title')}</h3>
        <p className="mt-1 text-sm text-muted">{t('ledger.rates.revalue.lede')}</p>
        {confirming ? (
          <div className="mt-2 flex flex-wrap gap-3">
            <Button type="button" onClick={() => void revalue()}>{t('ledger.rates.revalue.confirm')}</Button>
            <Button outline type="button" onClick={() => setConfirming(false)}>{t('ledger.cancel')}</Button>
          </div>
        ) : (
          <Button outline className="mt-2" type="button" onClick={() => { setSummary(undefined); setConfirming(true); }}>{t('ledger.rates.revalue.button')}</Button>
        )}
        {summary ? <p role="status" className="mt-2" data-testid="revalue-summary">{summary}</p> : null}
      </div>
    </section>
  );
}
