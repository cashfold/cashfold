'use client';

import { canTransition, MAX_NOTE, type TransferRow, type TxnStatus } from '@cashfold/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { InputField, SelectField, TextareaField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { deviceOffsetAt, inputToMoment, momentToInput, nowInput } from '../ledger/dates';
import { decimalsOf, formatPlain, formatRate } from '../ledger/format';
import { useLedger } from '../ledger/LedgerProvider';
import { suggestDestination } from '../ledger/transfer/suggest';
import { Button, Disclosure, SelectOption } from '../kit';
import { AmountInput } from './AmountInput';
import { isDirty } from './dirty';
import type { ModeReport } from './modes';
import { RatePrompt } from './RatePrompt';
import { prefsStore } from '../prefs/usePrefs';
import { recordRecents } from './recents';
import { AccountOption } from '../accounts/AccountOption';

/** Move money between two accounts (the transfer mode of the add sheet). The command and payload are those of the former Transfers screen. */
export function TransferMode({ formId, existing, accountId, report }: { formId: string; existing?: TransferRow | undefined; accountId?: string | undefined; report: ModeReport }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const usable = basics.accounts.filter((a) => !a.archived || a.id === existing?.fromAccountId || a.id === existing?.toAccountId);
  const [fromId, setFromId] = useState<string>(existing?.fromAccountId ?? accountId ?? usable[0]?.id ?? '');
  const [toId, setToId] = useState<string>(existing?.toAccountId ?? usable.find((a) => a.id !== (accountId ?? usable[0]?.id))?.id ?? usable[0]?.id ?? '');
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
  const [needRate, setNeedRate] = useState<{ currency: string; asOfUtcS: number } | undefined>();
  const initial = useRef({ fromId, toId, fromText, toText, when, note, status });

  const fromParsed = from === undefined || fromText.trim() === '' ? undefined : ledger.parse(fromText, from.currency);
  const toParsed = to === undefined ? undefined : sameCurrency ? fromParsed : toText.trim() === '' ? undefined : ledger.parse(toText, to.currency);

  useEffect(() => {
    report.dirty(isDirty(initial.current, { fromId, toId, fromText, toText, when, note, status }));
  }, [fromId, toId, fromText, toText, when, note, status, report]);

  function suggest() {
    setHint(undefined);
    if (from === undefined || to === undefined || fromParsed === undefined || !fromParsed.ok) return setHint(t('ledger.xfer.suggest.needAmount'));
    const atUtcS = Number(BigInt(inputToMoment(when, deviceOffsetAt(when)) ?? Date.now()) / 1000n);
    const s = suggestDestination(fromParsed.value, from.currency, to.currency, basics.rates as never, atUtcS);
    if (s === undefined) return setHint(t('ledger.xfer.suggest.noRate', { from: from.currency, to: to.currency }));
    setToText(formatPlain(s.toMinor, to.currency, locale));
    setRateId(s.rateId);
  }

  const implied = fromParsed?.ok && toParsed?.ok && !sameCurrency && from && to && fromParsed.value > 0n
    ? formatRate(((toParsed.value * 10n ** BigInt(decimalsOf(from.currency)) * 10n ** 12n) / (fromParsed.value * 10n ** BigInt(decimalsOf(to.currency)))), locale)
    : undefined;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(undefined);
    if (from === undefined || to === undefined) return setError(t('ledger.xfer.error.accounts'));
    if (fromParsed === undefined || !fromParsed.ok) return setError(t('ledger.xfer.error.fromAmount'));
    if (toParsed === undefined || !toParsed.ok) return setError(t('ledger.xfer.error.toAmount'));
    const tzOffsetMin = existing === undefined ? deviceOffsetAt(when) : existing.tzOffsetMin;
    const occurredUtcMs = inputToMoment(when, tzOffsetMin);
    if (occurredUtcMs === undefined) return setError(t('ledger.tx.error.when'));
    report.busy(true);
    try {
      const common = { fromAccountId: from.id, toAccountId: to.id, fromAmountMinor: fromParsed.value, toAmountMinor: toParsed.value, note, status };
      const result = existing === undefined
        ? await ledger.run('ledger.addTransfer', { ...common, occurredUtcMs, tzOffsetMin, fxRateId: rateId })
        : await ledger.run('ledger.updateTransfer', { id: existing.id, changes: { ...common, fxRateId: rateId, ...(when !== initialWhen && { occurredUtcMs, tzOffsetMin }) } });
      if (result.ok) {
        if (ledger.fold !== undefined) prefsStore.update((p) => ({ ...p, recents: recordRecents(p.recents, ledger.fold!.id, from.id, null) }));
        return report.done('status.transferSaved');
      }
      if (result.error.code === 'rate_required' && result.error.currency !== undefined) {
        setNeedRate({ currency: result.error.currency, asOfUtcS: Number(BigInt(occurredUtcMs) / 1000n) });
        report.rateMode(true);
        return;
      }
      setError(ledger.explain(result.error.code));
    } finally {
      report.busy(false);
    }
  }

  if (needRate) {
    return <RatePrompt {...needRate} formId={formId} onSaved={() => { setNeedRate(undefined); report.rateMode(false); void submit(); }} />;
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      <SelectField label={t('ledger.xfer.from')} value={fromId} onChange={setFromId}>
        {usable.map((a) => <AccountOption key={a.id} account={a} />)}
      </SelectField>
      <SelectField label={t('ledger.xfer.to')} value={toId} onChange={setToId}>
        {usable.map((a) => <AccountOption key={a.id} account={a} />)}
      </SelectField>
      <AmountInput label={t('ledger.xfer.fromAmount')} currency={from?.currency ?? 'USD'} value={fromText} onChange={setFromText} autoFocus />
      {sameCurrency ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="mirrored">{t('ledger.xfer.mirrored', { currency: from.currency })}</p>
      ) : (
        <>
          <AmountInput label={t('ledger.xfer.toAmount')} currency={to?.currency ?? 'USD'} value={toText} onChange={setToText} hint={t('ledger.xfer.toAmount.hint')} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" outline onClick={suggest}>{t('ledger.xfer.suggest')}</Button>
            {implied !== undefined ? <span className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="implied-rate">{t('ledger.xfer.implied', { from: from!.currency, to: to!.currency, rate: implied })}</span> : null}
          </div>
          {hint ? <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{hint}</p> : null}
          {rateId !== null ? <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="rate-used">{t('ledger.xfer.basedOn')}</p> : null}
        </>
      )}
      <InputField label={t('ledger.tx.when')} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      <Disclosure title={t('ledger.add.more')} summary={t('ledger.add.moreSummaryTransfer')} defaultOpen={existing !== undefined && (note !== '' || status !== 'posted')}>
        <div className="space-y-4">
          <TextareaField label={t('ledger.tx.note')} rows={2} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
          <SelectField label={t('ledger.tx.status')} value={status} onChange={(v) => setStatus(v as TxnStatus)}>
            {(['pending', 'posted', 'void'] as const).filter((s) => existing === undefined || canTransition(existing.status, s)).map((s) => <SelectOption key={s} value={s}>{t(`ledger.status.${s}`)}</SelectOption>)}
          </SelectField>
        </div>
      </Disclosure>
      {error ? <p role="alert" className="text-(--danger)">{error}</p> : null}
    </form>
  );
}
