'use client';

import type { TransferRow, TxnStatus } from '@cashfold/core';
import { canTransition, MAX_NOTE } from '@cashfold/core';
import { useState, type FormEvent } from 'react';
import { buttonClass, secondaryButtonClass, TextField } from '../../forms/TextField';
import { useI18n } from '../../i18n/I18nProvider';
import { AmountField } from '../AmountField';
import { deviceOffsetAt, inputToMoment, momentToInput, nowInput } from '../dates';
import { decimalsOf, formatPlain, formatRate } from '../format';
import { useLedger } from '../LedgerProvider';
import { suggestDestination } from './suggest';

/** Move money between two accounts: one record with the amount that leaves and the amount that arrives. */
export function TransferForm({ existing, onDone }: { existing?: TransferRow; onDone: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const usable = basics.accounts.filter((a) => !a.archived || a.id === existing?.fromAccountId || a.id === existing?.toAccountId);
  const [fromId, setFromId] = useState<string>(existing?.fromAccountId ?? usable[0]?.id ?? '');
  const [toId, setToId] = useState<string>(existing?.toAccountId ?? usable[1]?.id ?? usable[0]?.id ?? '');
  const from = basics.accounts.find((a) => a.id === fromId);
  const to = basics.accounts.find((a) => a.id === toId);
  const sameCurrency = from !== undefined && to !== undefined && from.currency === to.currency;

  const initialWhen = existing === undefined ? nowInput() : momentToInput(existing.occurredUtcMs, existing.tzOffsetMin);
  const [fromText, setFromText] = useState(existing === undefined || from === undefined ? '' : formatPlain(existing.fromAmountMinor, from.currency, locale));
  const [toText, setToText] = useState(existing === undefined || to === undefined ? '' : formatPlain(existing.toAmountMinor, to.currency, locale));
  const [when, setWhen] = useState(initialWhen);
  const [note, setNote] = useState(existing?.note ?? '');
  const [status, setStatus] = useState<TxnStatus>(existing?.status ?? 'posted');
  const [rateId, setRateId] = useState<string | null>(existing?.fxRateId ?? null);
  const [error, setError] = useState<string | undefined>();
  const [hint, setHint] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const fromParsed = from === undefined || fromText.trim() === '' ? undefined : ledger.parse(fromText, from.currency);
  const toParsed = to === undefined ? undefined : sameCurrency ? fromParsed : toText.trim() === '' ? undefined : ledger.parse(toText, to.currency);

  /** Fills the destination from the known rates, only when asked, and says which rate it used. */
  function suggest() {
    setHint(undefined);
    if (from === undefined || to === undefined || fromParsed === undefined || !fromParsed.ok) return setHint(t('ledger.xfer.suggest.needAmount'));
    const atUtcS = Number(BigInt(inputToMoment(when, deviceOffsetAt(when)) ?? Date.now()) / 1000n);
    const s = suggestDestination(fromParsed.value, from.currency, to.currency, basics.rates as never, atUtcS);
    if (s === undefined) return setHint(t('ledger.xfer.suggest.noRate', { from: from.currency, to: to.currency }));
    setToText(formatPlain(s.toMinor, to.currency, locale));
    setRateId(s.rateId);
  }

  // The rate the two amounts imply, so the person can see what they are agreeing to. Display only.
  const implied = fromParsed?.ok && toParsed?.ok && !sameCurrency && from && to && fromParsed.value > 0n
    ? formatRate(((toParsed.value * 10n ** BigInt(decimalsOf(from.currency)) * 10n ** 12n) / (fromParsed.value * 10n ** BigInt(decimalsOf(to.currency)))), locale)
    : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (from === undefined || to === undefined) return setError(t('ledger.xfer.error.accounts'));
    if (fromParsed === undefined || !fromParsed.ok) return setError(t('ledger.xfer.error.fromAmount'));
    if (toParsed === undefined || !toParsed.ok) return setError(t('ledger.xfer.error.toAmount'));
    const tzOffsetMin = existing === undefined ? deviceOffsetAt(when) : existing.tzOffsetMin;
    const occurredUtcMs = inputToMoment(when, tzOffsetMin);
    if (occurredUtcMs === undefined) return setError(t('ledger.tx.error.when'));
    setBusy(true);
    try {
      const common = { fromAccountId: from.id, toAccountId: to.id, fromAmountMinor: fromParsed.value, toAmountMinor: toParsed.value, note, status };
      const result = existing === undefined
        ? await ledger.run('ledger.addTransfer', { ...common, occurredUtcMs, tzOffsetMin, fxRateId: rateId })
        : await ledger.run('ledger.updateTransfer', { id: existing.id, changes: { ...common, fxRateId: rateId, ...(when !== initialWhen && { occurredUtcMs, tzOffsetMin }) } });
      if (result.ok) onDone();
      else setError(ledger.explain(result.error.code));
    } finally {
      setBusy(false);
    }
  }

  const select = 'mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2';
  return (
    <form onSubmit={submit}>
      <div className="mt-4">
        <label htmlFor="xf-from" className="block font-medium">{t('ledger.xfer.from')}</label>
        <select id="xf-from" className={select} value={fromId} onChange={(e) => setFromId(e.target.value)} required>
          {usable.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </div>
      <div className="mt-4">
        <label htmlFor="xf-to" className="block font-medium">{t('ledger.xfer.to')}</label>
        <select id="xf-to" className={select} value={toId} onChange={(e) => setToId(e.target.value)} required>
          {usable.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </div>

      <AmountField label={t('ledger.xfer.fromAmount')} currency={from?.currency ?? 'USD'} value={fromText} onChange={setFromText} required />
      {sameCurrency ? (
        <p className="mt-3 text-sm text-muted" data-testid="mirrored">{t('ledger.xfer.mirrored', { currency: from.currency })}</p>
      ) : (
        <>
          <AmountField label={t('ledger.xfer.toAmount')} currency={to?.currency ?? 'USD'} value={toText} onChange={setToText} required hint={t('ledger.xfer.toAmount.hint')} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className={secondaryButtonClass} onClick={suggest}>{t('ledger.xfer.suggest')}</button>
            {implied !== undefined ? <span className="text-sm text-muted" data-testid="implied-rate">{t('ledger.xfer.implied', { from: from!.currency, to: to!.currency, rate: implied })}</span> : null}
          </div>
          {hint ? <p role="status" className="mt-2 text-sm text-muted">{hint}</p> : null}
          {rateId !== null ? <p className="mt-1 text-sm text-muted" data-testid="rate-used">{t('ledger.xfer.basedOn')}</p> : null}
        </>
      )}

      <TextField label={t('ledger.tx.when')} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      <div className="mt-4">
        <label htmlFor="xf-note" className="block font-medium">{t('ledger.tx.note')}</label>
        <textarea id="xf-note" className={select} rows={2} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="mt-4">
        <label htmlFor="xf-status" className="block font-medium">{t('ledger.tx.status')}</label>
        <select id="xf-status" className={select} value={status} onChange={(e) => setStatus(e.target.value as TxnStatus)}>
          {(['pending', 'posted', 'void'] as const).filter((s) => existing === undefined || canTransition(existing.status, s)).map((s) => <option key={s} value={s}>{t(`ledger.status.${s}`)}</option>)}
        </select>
      </div>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="submit" className={buttonClass} disabled={busy}>{existing === undefined ? t('ledger.xfer.add.submit') : t('ledger.save')}</button>
        <button type="button" className={secondaryButtonClass} onClick={onDone}>{t('ledger.cancel')}</button>
      </div>
    </form>
  );
}
