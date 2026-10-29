'use client';

import type { DashboardData, DayBalance, LocalDate, Period } from '@cashfold/core';
import { addDays, resolvePeriod as resolveCorePeriod } from '@cashfold/core';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { InputField, SelectField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { Amount, Button, Disclosure, EmptyState, Label, Notice, Sheet, Stat, Switch, SwitchField, BanknotesIcon, PlusIcon, SelectOption } from '../kit';
import { dateToInput, formatDate, inputToDate, todayLocal } from '../ledger/dates';
import { parseRateText, percentOf } from '../ledger/format';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';
import type { OverviewSectionId, PeriodChoice } from '../prefs/schema';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useAddSheet } from '../shell/add-context';
import { FirstRunChecklist } from '../firstrun/FirstRunChecklist';
import { breakdownHref } from './links';
import { resolvePeriod } from './period';

const PERIODS = ['thisMonth', 'lastMonth', 'thisYear', 'lastYear', 'last30', 'last90', 'all', 'custom'] as const;

/** Waits for the Fold's lists, then shows the screen: the body below can rely on them being there. */
export function OverviewScreen() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.overview.title">{null}</LedgerFrame>;
  return <OverviewBody />;
}

function OverviewBody() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const { openAdd } = useAddSheet();
  const basics = ledger.basics!;
  const today = useMemo(() => todayLocal(), []);
  const choice = usePrefs((p) => p.overview.period);
  const collapsed = usePrefs((p) => p.overview.collapsed);
  const [adjustments, setAdjustments] = useState(false);
  const [transfers, setTransfers] = useState(false);
  const [data, setData] = useState<DashboardData | undefined>();
  const [failed, setFailed] = useState(false);
  const [account, setAccount] = useState('');
  const [rates, setRates] = useState<string[] | undefined>();

  const resolved = useMemo(() => resolvePeriod(choice, today), [choice, today]);
  const period: Period = useMemo(
    () => resolveCorePeriod(resolved.from === null ? { kind: 'all_time' } : { kind: 'custom', from: inputToDate(resolved.from) ?? today, to: inputToDate(resolved.to ?? resolved.from) ?? today }, today),
    [resolved, today],
  );
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

  const setChoice = (next: PeriodChoice) => prefsStore.update((p) => ({ ...p, overview: { ...p.overview, period: next } }));
  const toggle = (id: OverviewSectionId, open: boolean) =>
    prefsStore.update((p) => ({ ...p, overview: { ...p.overview, collapsed: open ? p.overview.collapsed.filter((x) => x !== id) : [...new Set([...p.overview.collapsed, id])] } }));
  const openState = (id: OverviewSectionId) => !collapsed.includes(id);

  const currency = data?.incomeExpense.currency ?? basics.baseCurrency ?? 'USD';
  const categories = useMemo(() => new Map(basics.categories.map((c) => [c.id, c.name])), [basics.categories]);
  const tags = useMemo(() => new Map(basics.tags.map((x) => [x.id, x.name])), [basics.tags]);
  const missing = data === undefined ? [] : [...new Set([...data.netWorth.missing, ...data.incomeExpense.missingRates])].sort();
  const customFrom = choice.kind === 'custom' ? choice.from : resolved.from ?? dateToInput(addDays(today, -29));
  const customTo = choice.kind === 'custom' ? choice.to : resolved.to ?? dateToInput(today);

  const header = (
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <SelectField
        label={t('overview.period')} value={choice.kind}
        onChange={(kind) => {
          setChoice(kind === 'custom' ? { kind: 'custom', from: customFrom, to: customTo >= customFrom ? customTo : customFrom } : { kind });
        }}
      >
        {PERIODS.map((p) => <SelectOption key={p} value={p}>{t(`overview.period.${p}`)}</SelectOption>)}
      </SelectField>
      {choice.kind === 'custom' ? (
        <>
          <InputField label={t('ledger.filter.from')} type="date" value={choice.from} max={choice.to} onChange={(e) => e.target.value && setChoice({ kind: 'custom', from: e.target.value, to: choice.to })} />
          <InputField label={t('ledger.filter.to')} type="date" value={choice.to} min={choice.from} onChange={(e) => e.target.value && setChoice({ kind: 'custom', from: choice.from, to: e.target.value })} />
        </>
      ) : null}
    </div>
  );

  const noAccounts = basics.accounts.length === 0;
  const noTransactions = !noAccounts && data !== undefined && data.incomeExpense.incomeMinor === 0n && data.incomeExpense.expenseMinor === 0n && data.netWorth.accounts.every((a) => a.balanceMinor === 0n) && data.spending.rows.length === 0;

  return (
    <LedgerFrame titleKey="page.overview.title">
      <FirstRunChecklist />
      {noAccounts ? (
        <EmptyState className="mt-6" icon={BanknotesIcon} title={t('overview.empty.account.title')} body={t('overview.empty.account.body')} action={<Link href="/accounts/" className="underline">{t('overview.empty.account.action')}</Link>} />
      ) : (
        <>
          {header}
          <p className="mt-2 text-sm/6 text-zinc-600 dark:text-zinc-400">
            {resolved.from === null ? t('overview.showing.all', { currency }) : t('ledger.dash.showing', { from: formatDate(period.from, locale), to: formatDate(period.to, locale), currency })}
          </p>

          {failed ? <p role="alert" className="mt-4 text-(--danger)">{t('ledger.error.load')}</p> : null}
          {data === undefined ? (failed ? null : <p role="status" className="mt-4 text-zinc-600">{t('loading')}</p>) : (
            <>
              {missing.length > 0 ? (
                <Notice className="mt-4" tone="warning" title={t('overview.missingRates', { currencies: missing.join(', ') })} action={<Button outline onClick={() => setRates(missing)}>{t('overview.missingRates.action')}</Button>}>
                  {t('overview.missingRates.body')}
                </Notice>
              ) : null}

              <div role="group" className="mt-6 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4" aria-label={t('ledger.dash.summary')}>
                <Stat label={t('ledger.dash.income')} tone="gain" value={<span data-testid="income"><Amount minor={data.incomeExpense.incomeMinor} currency={currency} locale={locale} /></span>} />
                <Stat label={t('ledger.dash.expense')} tone="loss" value={<span data-testid="expense"><Amount minor={data.incomeExpense.expenseMinor} currency={currency} locale={locale} /></span>} />
                <Stat label={t('ledger.dash.net')} tone={data.incomeExpense.netMinor > 0n ? 'gain' : data.incomeExpense.netMinor < 0n ? 'loss' : 'neutral'} value={<span data-testid="net"><Amount minor={data.incomeExpense.netMinor} currency={currency} locale={locale} showSign /></span>} />
                <Stat
                  label={t('overview.totalBalance')} hint={t('ledger.dash.netWorth.asOf', { date: formatDate(asOf, locale) })}
                  value={<span data-testid="net-worth">{data.netWorth.totalMinor === null ? t('ledger.dash.netWorth.unavailable') : <Amount minor={data.netWorth.totalMinor} currency={currency} locale={locale} />}</span>}
                />
              </div>
              {adjustments || transfers ? (
                <p className="mt-2 text-sm/6 text-zinc-600 dark:text-zinc-400" data-testid="options-note">
                  {t('overview.options.note', { what: [adjustments ? t('overview.options.adjustments') : '', transfers ? t('overview.options.transfers') : ''].filter(Boolean).join(', ') })}
                </p>
              ) : null}

              <Disclosure className="mt-4" title={t('overview.options')} summary={adjustments || transfers ? t('overview.options.changed') : undefined}>
                <div className="space-y-3">
                  <SwitchField><Label>{t('ledger.dash.adjustments')}</Label><Switch checked={adjustments} onChange={setAdjustments} /></SwitchField>
                  <SwitchField><Label>{t('ledger.dash.transfers')}</Label><Switch checked={transfers} onChange={setTransfers} /></SwitchField>
                </div>
              </Disclosure>

              {noTransactions ? (
                <EmptyState className="mt-6" icon={PlusIcon} title={t('overview.empty.tx.title')} body={t('overview.empty.tx.body')} action={<Button onClick={() => openAdd()}>{t('overview.empty.tx.action')}</Button>} />
              ) : null}

              <div className="mt-6 space-y-3">
                <Section id="category" title={t('ledger.dash.byCategory')} summary={summaryOf(data.spending.rows.length, t)} open={openState('category')} onToggle={toggle}>
                  <Breakdown
                    empty={t('ledger.dash.nothing')} totalMinor={data.spending.totalMinor} currency={currency}
                    rows={data.spending.rows.map((r) => ({ key: r.categoryId ?? 'none', name: r.categoryId === null ? t('ledger.dash.uncategorised') : categories.get(r.categoryId) ?? t('ledger.dash.unknown'), minor: r.amountMinor, href: r.categoryId === null ? undefined : breakdownHref({ kind: 'category', id: r.categoryId }, resolved) }))}
                  />
                </Section>
                <Section id="tag" title={t('ledger.dash.byTag')} summary={summaryOf(data.tags.rows.length, t)} open={openState('tag')} onToggle={toggle}>
                  <Breakdown
                    empty={t('ledger.dash.nothing')} totalMinor={data.tags.totalMinor} currency={currency}
                    rows={data.tags.rows.map((r) => ({ key: r.tagId, name: tags.get(r.tagId) ?? t('ledger.dash.unknown'), minor: r.amountMinor, href: breakdownHref({ kind: 'tag', id: r.tagId }, resolved) }))}
                  />
                </Section>
                <Section id="trend" title={t('ledger.dash.trend')} summary={t('overview.months', { count: Math.min(data.trend.length, 24) })} open={openState('trend')} onToggle={toggle}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-start">
                      <caption className="sr-only">{t('ledger.dash.trend')}</caption>
                      <thead><tr><th scope="col" className="text-start">{t('ledger.dash.month')}</th><th scope="col" className="text-end">{t('ledger.dash.income')}</th><th scope="col" className="text-end">{t('ledger.dash.expense')}</th><th scope="col" className="text-end">{t('ledger.dash.net')}</th></tr></thead>
                      <tbody>
                        {data.trend.slice(-24).map((m) => (
                          <tr key={m.month}>
                            <th scope="row" className="text-start font-normal">{`${Math.trunc(m.month / 100)}-${String(m.month % 100).padStart(2, '0')}`}</th>
                            <td><Amount minor={m.incomeMinor} currency={currency} locale={locale} align="end" /></td>
                            <td><Amount minor={m.expenseMinor} currency={currency} locale={locale} align="end" /></td>
                            <td><Amount minor={m.netMinor} currency={currency} locale={locale} align="end" showSign /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
                <Section id="balance" title={t('ledger.dash.dayEnd')} summary={undefined} open={openState('balance')} onToggle={toggle}>
                  <DayEnd account={account} onAccount={setAccount} period={period} today={today} />
                </Section>
                <Section id="accounts" title={t('ledger.dash.accounts')} summary={t('overview.accountsCount', { count: data.netWorth.accounts.length })} open={openState('accounts')} onToggle={toggle}>
                  <ul className="divide-y divide-zinc-950/10 dark:divide-white/10">
                    {data.netWorth.accounts.map((a) => (
                      <li key={a.accountId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link className="underline" href={breakdownHref({ kind: 'account', id: a.accountId }, resolved)}>{basics.accounts.find((x) => x.id === a.accountId)?.name}</Link>
                        <span className="tabular-nums">{ledger.money(a.balanceMinor, a.currency)}{a.currency !== currency && a.baseMinor !== null ? ` ≈ ${ledger.money(a.baseMinor, currency)}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            </>
          )}
        </>
      )}
      <RatesSheet currencies={rates} onClose={() => setRates(undefined)} />
    </LedgerFrame>
  );
}

function summaryOf(count: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  return t('overview.rows', { count });
}

function Section({ id, title, summary, open, onToggle, children }: { id: OverviewSectionId; title: string; summary: string | undefined; open: boolean; onToggle: (id: OverviewSectionId, open: boolean) => void; children: ReactNode }) {
  return (
    <Disclosure title={title} {...(summary === undefined ? {} : { summary })} open={open} onOpenChange={(o) => onToggle(id, o)}>
      {children}
    </Disclosure>
  );
}

function Breakdown({ empty, rows, totalMinor, currency }: { empty: string; rows: Array<{ key: string; name: string; minor: bigint; href: string | undefined }>; totalMinor: bigint; currency: string }) {
  const ledger = useLedger();
  return (
    <>
      {rows.length === 0 ? <p className="text-zinc-600 dark:text-zinc-400">{empty}</p> : null}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex justify-between gap-3">
              {r.href ? <Link className="underline" href={r.href}>{r.name}</Link> : <span>{r.name}</span>}
              <span className="tabular-nums">{ledger.money(r.minor, currency)}</span>
            </div>
            <progress className="mt-1 block h-2 w-full appearance-none overflow-hidden rounded-full bg-zinc-200 [&::-moz-progress-bar]:bg-(--primary) [&::-webkit-progress-bar]:bg-zinc-200 [&::-webkit-progress-value]:bg-(--primary) dark:bg-white/10 dark:[&::-webkit-progress-bar]:bg-white/10" value={percentOf(r.minor, totalMinor)} max={100} aria-hidden="true" />
          </li>
        ))}
      </ul>
    </>
  );
}

/** Asks for the missing rates in a sheet: a total with a hole in it says so once and offers to fill it. */
function RatesSheet({ currencies, onClose }: { currencies: readonly string[] | undefined; onClose: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();

  async function save(event: FormEvent) {
    event.preventDefault();
    for (const quote of currencies ?? []) {
      if ((texts[quote] ?? '').trim() === '') continue;
      const rate = parseRateText(texts[quote] ?? '', locale);
      if (!rate.ok) return setError(t(`ledger.rate.${rate.error.code}`));
      const r = await ledger.run('ledger.setCustomRate', { quote, asOfUtcS: Number(BigInt(Date.now()) / 1000n), rateE12: rate.value });
      if (!r.ok) return setError(ledger.explain(r.error.code));
    }
    setError(undefined);
    onClose();
  }

  return (
    <Sheet
      open={currencies !== undefined} onClose={onClose} title={t('ledger.dash.missingRates')} description={t('ledger.dash.missingRates.lede', { currencies: (currencies ?? []).join(', ') })}
      footer={<><Button plain type="button" onClick={onClose}>{t('ledger.cancel')}</Button><Button type="submit" form="rates-form">{t('ledger.rate.save')}</Button></>}
    >
      <form id="rates-form" onSubmit={save} className="space-y-4">
        {(currencies ?? []).map((c) => (
          <InputField key={c} label={t('ledger.rate.label', { currency: c })} value={texts[c] ?? ''} onChange={(e) => setTexts((s) => ({ ...s, [c]: e.target.value }))} inputMode="decimal" autoComplete="off" />
        ))}
        {error ? <p role="alert" className="text-(--danger)">{error}</p> : null}
      </form>
    </Sheet>
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
    <div>
      <SelectField label={t('ledger.tx.account')} value={chosen.id} onChange={onAccount}>
        {accounts.map((a) => <SelectOption key={a.id} value={a.id}>{a.name}</SelectOption>)}
      </SelectField>
      {days.length > 0 ? (
        <>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-3 w-full text-(--primary)" role="img" aria-label={t('ledger.dash.dayEnd.chart', { name: chosen.name, from: formatDate(range.from, locale), to: formatDate(range.to, locale) })}>
            <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <details className="mt-2">
            <summary className="cursor-pointer">{t('ledger.dash.dayEnd.table')}</summary>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-start">
                <thead><tr><th scope="col" className="text-start">{t('ledger.dash.date')}</th><th scope="col" className="text-end">{t('ledger.dash.balance')}</th></tr></thead>
                <tbody>{days.map((d) => <tr key={d.date}><th scope="row" className="text-start font-normal">{formatDate(d.date, locale)}</th><td><Amount minor={d.balanceMinor} currency={chosen.currency} locale={locale} align="end" /></td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      ) : <p className="mt-2 text-zinc-600 dark:text-zinc-400">{t('ledger.dash.nothing')}</p>}
    </div>
  );
}
