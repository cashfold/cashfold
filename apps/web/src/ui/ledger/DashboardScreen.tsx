'use client';

import type { DashboardData, DayBalance, LocalDate, Period, PeriodSpec } from '@cashfold/core';
import { addDays, resolvePeriod } from '@cashfold/core';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { TextField, buttonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { dateToInput, formatDate, inputToDate, todayLocal } from './dates';
import { parseRateText, percentOf, signOf } from './format';
import { LedgerFrame } from './LedgerFrame';
import { useLedger } from './LedgerProvider';

type Preset = 'this_month' | 'last_month' | 'this_year' | 'last_30' | 'all_time' | 'custom';

function specFor(preset: Preset, from: string, to: string): PeriodSpec {
  switch (preset) {
    case 'last_30': return { kind: 'last_days', days: 30 };
    case 'custom': return { kind: 'custom', from: inputToDate(from) ?? todayLocal(), to: inputToDate(to) ?? todayLocal() };
    default: return { kind: preset };
  }
}

/** Waits for the Fold's lists, then shows the screen: the body below can rely on them being there. */
export function DashboardScreen() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.dashboard.title">{null}</LedgerFrame>;
  return <DashboardBody />;
}

function DashboardBody() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const today = useMemo(() => todayLocal(), []);
  const [preset, setPreset] = useState<Preset>('this_month');
  const [from, setFrom] = useState(dateToInput(addDays(today, -29)));
  const [to, setTo] = useState(dateToInput(today));
  const [adjustments, setAdjustments] = useState(false);
  const [transfers, setTransfers] = useState(false);
  const [data, setData] = useState<DashboardData | undefined>();
  const [failed, setFailed] = useState(false);
  const [account, setAccount] = useState('');

  const period: Period = useMemo(() => resolvePeriod(specFor(preset, from, to), today), [preset, from, to, today]);
  const asOf = period.to < today ? period.to : today;

  useEffect(() => {
    let live = true;
    ledger
      .read<DashboardData>('ledger.dashboard', { period, asOf, options: { adjustmentsAsIncomeExpense: adjustments, transfersAsIncomeExpense: transfers } })
      .then((d) => live && (setData(d), setFailed(false)), () => live && setFailed(true));
    return () => {
      live = false;
    };
    // `ledger.version` is the signal that a command changed the data.
  }, [ledger.version, period, asOf, adjustments, transfers]);

  const currency = data?.incomeExpense.currency ?? basics.baseCurrency ?? 'USD';
  const categories = useMemo(() => new Map(basics.categories.map((c) => [c.id, c.name])), [basics.categories]);
  const tags = useMemo(() => new Map(basics.tags.map((x) => [x.id, x.name])), [basics.tags]);
  const selectClass = 'mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2';

  return (
    <LedgerFrame titleKey="page.dashboard.title">
      <form className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-3" aria-label={t('ledger.dash.options')} onSubmit={(e) => e.preventDefault()}>
        <div className="mt-4">
          <label htmlFor="d-period" className="block font-medium">{t('ledger.dash.period')}</label>
          <select id="d-period" className={selectClass} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {(['this_month', 'last_month', 'this_year', 'last_30', 'all_time', 'custom'] as const).map((p) => <option key={p} value={p}>{t(`ledger.dash.period.${p}`)}</option>)}
          </select>
        </div>
        {preset === 'custom' ? (
          <>
            <TextField label={t('ledger.filter.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label={t('ledger.filter.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : null}
        <label className="mt-4 flex items-center gap-2 self-end">
          <input type="checkbox" checked={adjustments} onChange={(e) => setAdjustments(e.target.checked)} />
          {t('ledger.dash.adjustments')}
        </label>
        <label className="mt-4 flex items-center gap-2 self-end">
          <input type="checkbox" checked={transfers} onChange={(e) => setTransfers(e.target.checked)} />
          {t('ledger.dash.transfers')}
        </label>
      </form>
      <p className="mt-2 text-sm text-muted">{t('ledger.dash.showing', { from: formatDate(period.from, locale), to: formatDate(period.to, locale), currency })}</p>

      {failed ? <p role="alert" className="mt-4 text-danger">{t('ledger.error.load')}</p> : null}
      {data === undefined ? (failed ? null : <p role="status" className="mt-4 text-muted">{t('loading')}</p>) : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label={t('ledger.dash.summary')}>
            <Card label={t('ledger.dash.income')} value={ledger.money(data.incomeExpense.incomeMinor, currency)} sign="gain" testId="income" />
            <Card label={t('ledger.dash.expense')} value={ledger.money(data.incomeExpense.expenseMinor, currency)} sign="loss" testId="expense" />
            <Card label={t('ledger.dash.net')} value={ledger.signed(data.incomeExpense.netMinor, currency)} sign={signOf(data.incomeExpense.netMinor)} testId="net" />
          </section>

          <section className="mt-8" aria-labelledby="nw-title">
            <h2 id="nw-title" className="text-lg font-semibold">{t('ledger.dash.netWorth')}</h2>
            <p className="mt-1 text-sm text-muted">{t('ledger.dash.netWorth.asOf', { date: formatDate(asOf, locale) })}</p>
            <p className="mt-2 text-2xl" data-testid="net-worth">{data.netWorth.totalMinor === null ? t('ledger.dash.netWorth.unavailable') : ledger.money(data.netWorth.totalMinor, currency)}</p>
            {data.netWorth.missing.length > 0 ? <MissingRates currencies={data.netWorth.missing} /> : null}
            <ul className="mt-3 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('ledger.dash.accounts')}>
              {data.netWorth.accounts.map((a) => (
                <li key={a.accountId} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span>{basics.accounts.find((x) => x.id === a.accountId)?.name}</span>
                  <span>{ledger.money(a.balanceMinor, a.currency)}{a.currency !== currency && a.baseMinor !== null ? ` ≈ ${ledger.money(a.baseMinor, currency)}` : ''}</span>
                </li>
              ))}
            </ul>
          </section>

          <Breakdown
            titleId="spend-cat" title={t('ledger.dash.byCategory')} empty={t('ledger.dash.nothing')} totalMinor={data.spending.totalMinor} currency={currency}
            rows={data.spending.rows.map((r) => ({ key: r.categoryId ?? 'none', name: r.categoryId === null ? t('ledger.dash.uncategorised') : categories.get(r.categoryId) ?? t('ledger.dash.unknown'), minor: r.amountMinor }))}
          />
          <Breakdown
            titleId="spend-tag" title={t('ledger.dash.byTag')} empty={t('ledger.dash.nothing')} totalMinor={data.tags.totalMinor} currency={currency}
            rows={data.tags.rows.map((r) => ({ key: r.tagId, name: tags.get(r.tagId) ?? t('ledger.dash.unknown'), minor: r.amountMinor }))}
          />

          <section className="mt-8" aria-labelledby="trend-title">
            <h2 id="trend-title" className="text-lg font-semibold">{t('ledger.dash.trend')}</h2>
            <table className="mt-2 w-full text-start">
              <caption className="sr-only">{t('ledger.dash.trend')}</caption>
              <thead><tr><th scope="col" className="text-start">{t('ledger.dash.month')}</th><th scope="col" className="text-start">{t('ledger.dash.income')}</th><th scope="col" className="text-start">{t('ledger.dash.expense')}</th><th scope="col" className="text-start">{t('ledger.dash.net')}</th></tr></thead>
              <tbody>
                {data.trend.slice(-24).map((m) => (
                  <tr key={m.month}>
                    <th scope="row" className="text-start font-normal">{m.month % 100 < 10 ? `${(m.month - (m.month % 100)) / 100}-0${m.month % 100}` : `${(m.month - (m.month % 100)) / 100}-${m.month % 100}`}</th>
                    <td>{ledger.money(m.incomeMinor, currency)}</td>
                    <td>{ledger.money(m.expenseMinor, currency)}</td>
                    <td>{ledger.signed(m.netMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <DayEnd account={account} onAccount={setAccount} period={period} today={today} />
    </LedgerFrame>
  );
}

function Card({ label, value, sign, testId }: { label: string; value: string; sign: 'gain' | 'loss' | 'zero'; testId: string }) {
  return (
    <div className="rounded-ui border border-border-strong p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 text-xl ${sign === 'gain' ? 'text-success' : ''}`} data-sign={sign} data-testid={testId}>{value}</div>
    </div>
  );
}

function Breakdown({ titleId, title, empty, rows, totalMinor, currency }: { titleId: string; title: string; empty: string; rows: Array<{ key: string; name: string; minor: bigint }>; totalMinor: bigint; currency: string }) {
  const ledger = useLedger();
  return (
    <section className="mt-8" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="mt-2 text-muted">{empty}</p> : null}
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex justify-between gap-3"><span>{r.name}</span><span>{ledger.money(r.minor, currency)}</span></div>
            <div className="mt-1 h-2 rounded-ui bg-surface" aria-hidden="true"><div className="h-2 rounded-ui bg-primary" style={{ width: `${percentOf(r.minor, totalMinor)}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Asks for the missing rates inline: a net worth with a hole in it says so and offers to fill it. */
function MissingRates({ currencies }: { currencies: readonly string[] }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();

  async function save(event: FormEvent, quote: string) {
    event.preventDefault();
    const rate = parseRateText(texts[quote] ?? '', locale);
    if (!rate.ok) return setError(t(`ledger.rate.${rate.error.code}`));
    const r = await ledger.run('ledger.setCustomRate', { quote, asOfUtcS: Number(BigInt(Date.now()) / 1000n), rateE12: rate.value });
    setError(r.ok ? undefined : ledger.explain(r.error.code));
  }

  return (
    <div className="mt-3 rounded-ui border border-border-strong p-3" role="group" aria-label={t('ledger.dash.missingRates')}>
      <p><span aria-hidden="true">! </span>{t('ledger.dash.missingRates.lede', { currencies: currencies.join(', ') })}</p>
      {currencies.map((c) => (
        <form key={c} className="flex flex-wrap items-end gap-2" onSubmit={(e) => void save(e, c)}>
          <TextField label={t('ledger.rate.label', { currency: c })} value={texts[c] ?? ''} onChange={(e) => setTexts((s) => ({ ...s, [c]: e.target.value }))} inputMode="decimal" autoComplete="off" />
          <button type="submit" className={buttonClass}>{t('ledger.rate.save')}</button>
        </form>
      ))}
      {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
    </div>
  );
}

function DayEnd({ account, onAccount, period, today }: { account: string; onAccount: (id: string) => void; period: Period; today: LocalDate }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const accounts = ledger.basics!.accounts.filter((a) => !a.archived);
  const chosen = accounts.find((a) => a.id === account) ?? accounts[0];
  const [days, setDays] = useState<DayBalance[]>([]);
  const range = useMemo(() => {
    const end = period.to < today ? period.to : today;
    const start = addDays(end, -89);
    return { from: period.from > start ? period.from : start, to: end };
  }, [period, today]);

  useEffect(() => {
    if (chosen === undefined) return;
    let live = true;
    ledger.read<{ ok: boolean; value?: DayBalance[] }>('ledger.dayEndBalances', { account: chosen.id, range }).then((r) => live && setDays(r.ok && r.value ? r.value : []), () => live && setDays([]));
    return () => {
      live = false;
    };
  }, [chosen?.id, range, ledger.version]);

  if (chosen === undefined) return null;
  const points = days.map((d) => Number(d.balanceMinor));
  const low = points.reduce((m, v) => (v < m ? v : m), points[0] ?? 0);
  const high = points.reduce((m, v) => (v > m ? v : m), points[0] ?? 0);
  const span = high - low === 0 ? 1 : high - low;
  const WIDTH = 600;
  const HEIGHT = 120;
  const path = points.map((v, i) => `${points.length === 1 ? 0 : (i * WIDTH) / (points.length - 1)},${HEIGHT - ((v - low) / span) * HEIGHT}`).join(' ');

  return (
    <section className="mt-8" aria-labelledby="dayend-title">
      <h2 id="dayend-title" className="text-lg font-semibold">{t('ledger.dash.dayEnd')}</h2>
      <div className="mt-2">
        <label htmlFor="d-account" className="block font-medium">{t('ledger.tx.account')}</label>
        <select id="d-account" className="mt-1 block rounded-ui border border-border-strong bg-bg px-3 py-2" value={chosen.id} onChange={(e) => onAccount(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {days.length > 0 ? (
        <>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-3 w-full text-primary" role="img" aria-label={t('ledger.dash.dayEnd.chart', { name: chosen.name, from: formatDate(range.from, locale), to: formatDate(range.to, locale) })}>
            <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <details className="mt-2">
            <summary className="cursor-pointer">{t('ledger.dash.dayEnd.table')}</summary>
            <table className="mt-2 w-full text-start">
              <thead><tr><th scope="col" className="text-start">{t('ledger.dash.date')}</th><th scope="col" className="text-start">{t('ledger.dash.balance')}</th></tr></thead>
              <tbody>{days.map((d) => <tr key={d.date}><th scope="row" className="text-start font-normal">{formatDate(d.date, locale)}</th><td>{ledger.money(d.balanceMinor, chosen.currency)}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      ) : <p className="mt-2 text-muted">{t('ledger.dash.nothing')}</p>}
    </section>
  );
}
