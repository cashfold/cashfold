'use client';

import { addDays, DEFAULT_HORIZON_DAYS, type PendingOccurrence, type ScheduleRow, type Upcoming } from '@cashfold/core';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { allowAmounts, amountsAllowed, permission, requestPermission } from '../../adapters/notifications/browser';
import { Modal } from '../forms/Modal';
import { TextField } from '../forms/TextField';
import { ArrowPathIcon, Button, Checkbox, CheckboxField, Disclosure, EmptyState, Label, Select } from '../kit';
import { useI18n } from '../i18n/I18nProvider';
import { AmountField } from '../ledger/AmountField';
import { dateToInput, formatDate, inputToDate, todayLocal } from '../ledger/dates';
import { formatPlain } from '../ledger/format';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';

const UNITS = ['day', 'week', 'month', 'year'] as const;
const REMINDERS = ['none', '0', '60', '1440'] as const;

export function SchedulesView() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.schedules.title">{null}</LedgerFrame>;
  return <SchedulesBody />;
}

function SchedulesBody() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [pending, setPending] = useState<PendingOccurrence[]>([]);
  const [editing, setEditing] = useState<{ row?: ScheduleRow } | undefined>();
  const [removing, setRemoving] = useState<ScheduleRow | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const accounts = useMemo(() => new Map(basics.accounts.map((a) => [a.id, a])), [basics.accounts]);

  // Occurrences that fell due while the app was closed are created when a screen is opened and when the window returns.
  useEffect(() => {
    const run = () => void ledger.run('schedules.materialise').catch(() => undefined);
    run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ledger.fold?.id]);

  const load = useCallback(async () => {
    try {
      const [list, soon, waiting] = await Promise.all([
        ledger.read<ScheduleRow[]>('schedules.list'), ledger.read<Upcoming[]>('schedules.upcoming'), ledger.read<PendingOccurrence[]>('schedules.pending'),
      ]);
      setRows(list);
      setUpcoming(soon);
      setPending(waiting);
    } catch {
      setMessage(t('ledger.error.load'));
    }
  }, [ledger.version, t]);
  useEffect(() => void load(), [load]);

  const amountText = (template: Upcoming['template']): string => {
    if (template.kind === 'transaction') {
      const a = accounts.get(template.accountId);
      return a ? ledger.signed(template.amountMinor, a.currency) : '—';
    }
    const from = accounts.get(template.fromAccountId);
    const to = accounts.get(template.toAccountId);
    return from && to ? t('schedules.transferAmount', { out: ledger.money(template.fromAmountMinor, from.currency), into: ledger.money(template.toAmountMinor, to.currency) }) : '—';
  };

  async function act(method: string, args: Record<string, unknown>) {
    const r = await ledger.run(method, args);
    if (!r.ok) setMessage(ledger.explain(r.error.code));
  }

  const active = rows.filter((r) => r.completedUtcMs === null);
  const finished = rows.filter((r) => r.completedUtcMs !== null);

  return (
    <LedgerFrame titleKey="page.schedules.title" actions={<Button type="button" onClick={() => setEditing({})} disabled={basics.accounts.length === 0}>{t('schedules.add')}</Button>}>
      <p className="mt-3 text-muted">{t('schedules.lede')}</p>
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}
      <ReminderSettings />

      <section className="mt-8" aria-labelledby="sch-inbox">
        <h2 id="sch-inbox" className="text-lg font-semibold">{t('schedules.inbox')}</h2>
        {pending.length === 0 ? <p className="mt-2 text-muted">{t('schedules.inbox.empty')}</p> : null}
        <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('schedules.inbox')}>
          {pending.map((p) => (
            <li key={`${p.scheduleId}:${p.n}`} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="pending-row">
              <div>
                <strong>{p.scheduleName}</strong>
                <p className="text-sm text-muted">{formatDate(p.record.localDate, locale)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => act('schedules.confirm', { schedule: p.scheduleId, n: p.n })} aria-label={`${t('schedules.confirm')} ${p.scheduleName}`}>{t('schedules.confirm')}</Button>
                <Button outline type="button" onClick={() => act('schedules.skip', { schedule: p.scheduleId, n: p.n })} aria-label={`${t('schedules.skip')} ${p.scheduleName}`}>{t('schedules.skip')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ProjectedBalances />

      <section className="mt-8" aria-labelledby="sch-upcoming">
        <h2 id="sch-upcoming" className="text-lg font-semibold">{t('schedules.upcoming')}</h2>
        <p className="text-sm text-muted">{t('schedules.upcoming.hint')}</p>
        {upcoming.length === 0 ? <p className="mt-2 text-muted">{t('schedules.upcoming.empty')}</p> : null}
        <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('schedules.upcoming')}>
          {upcoming.map((u) => (
            <li key={`${u.scheduleId}:${u.n}`} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="upcoming-row">
              <div>
                <strong>{u.name}</strong>
                <p className="text-sm text-muted">{formatDate(u.localDate, locale)}</p>
              </div>
              <span>{amountText(u.template)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="sch-active">
        <h2 id="sch-active" className="text-lg font-semibold">{t('schedules.active')}</h2>
        {active.length === 0 ? <EmptyState className="mt-2" icon={ArrowPathIcon} title={t('schedules.empty')} body={t('empty.schedules.body')} /> : null}
        <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('schedules.active')}>
          {active.map((s) => (
            <li key={s.id} className="p-3" data-testid="schedule-row">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>{s.name}</strong>
                  <p className="text-sm text-muted">
                    {t(`schedules.every.${s.unit}`, { count: s.interval })} · {s.next ? t('schedules.next', { date: formatDate(s.next, locale) }) : t('schedules.noNext')}
                    {s.requiresConfirmation ? ` · ${t('schedules.needsConfirmation')}` : ''}
                  </p>
                </div>
                <span>{amountText(s.template)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button outline type="button" onClick={() => setEditing({ row: s })} aria-label={`${t('ledger.edit')} ${s.name}`}>{t('ledger.edit')}</Button>
                <Button outline type="button" onClick={() => act('schedules.finish', { id: s.id })} aria-label={`${t('schedules.finish')} ${s.name}`}>{t('schedules.finish')}</Button>
                <Button outline type="button" onClick={() => setRemoving(s)} aria-label={`${t('ledger.delete')} ${s.name}`}>{t('ledger.delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {finished.length > 0 ? (
        <section className="mt-8" aria-labelledby="sch-done">
          <h2 id="sch-done" className="text-lg font-semibold">{t('schedules.finished')}</h2>
          <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong" aria-label={t('schedules.finished')}>
            {finished.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="finished-row">
                <strong>{s.name}</strong>
                <Button outline type="button" onClick={() => setRemoving(s)} aria-label={`${t('ledger.delete')} ${s.name}`}>{t('ledger.delete')}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Modal open={editing !== undefined} title={editing?.row ? t('schedules.edit') : t('schedules.add')} onClose={() => setEditing(undefined)}>
        {editing ? <ScheduleForm row={editing.row} onDone={() => setEditing(undefined)} /> : null}
      </Modal>
      <Modal open={removing !== undefined} title={t('schedules.delete.title')} onClose={() => setRemoving(undefined)}>
        {removing ? (
          <div>
            <p className="mt-3">{t('schedules.delete.explain', { name: removing.name })}</p>
            <div className="mt-6 flex gap-3">
              <Button type="button" onClick={async () => { await act('schedules.delete', { id: removing.id }); setRemoving(undefined); }}>{t('ledger.delete')}</Button>
              <Button outline type="button" onClick={() => setRemoving(undefined)}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}

/** Each account's balance on the last day of the horizon, counting pending entries and the occurrences still to come (FR-066). */
function ProjectedBalances() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const accounts = ledger.basics!.accounts.filter((a) => !a.archived);
  const [rows, setRows] = useState<Array<{ id: string; name: string; currency: string; now: bigint | null; later: bigint | undefined }>>([]);
  const asOf = useMemo(() => addDays(todayLocal(), DEFAULT_HORIZON_DAYS), []);
  useEffect(() => {
    let live = true;
    void Promise.all(accounts.map(async (a) => ({
      id: a.id, name: a.name, currency: a.currency, now: a.balanceMinor,
      later: await ledger.read<bigint | undefined>('schedules.projectedBalance', { account: a.id, asOf }).catch(() => undefined),
    }))).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [ledger.version, ledger.basics]);
  if (rows.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="sch-projected">
      <h2 id="sch-projected" className="text-lg font-semibold">{t('schedules.projected')}</h2>
      <p className="text-sm text-muted">{t('schedules.projected.hint', { date: formatDate(asOf, locale) })}</p>
      <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong" aria-label={t('schedules.projected')}>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="projected-row">
            <strong>{r.name}</strong>
            <span>
              <span className="text-muted">{r.now === null ? '—' : ledger.money(r.now, r.currency)} → </span>
              <span data-testid="projected-balance">{r.later === undefined ? '—' : ledger.money(r.later, r.currency)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Asking for notification permission is a deliberate step, never on load. Amounts stay off lock screens unless allowed. */
function ReminderSettings() {
  const { t } = useI18n();
  const [state, setState] = useState(permission());
  const [amounts, setAmounts] = useState(amountsAllowed());
  if (state === 'unsupported') return <p className="mt-3 text-sm text-muted">{t('schedules.notify.unsupported')}</p>;
  return (
    <div className="mt-4 rounded-ui border border-border-strong p-3">
      <p className="font-medium">{t('schedules.notify.title')}</p>
      {state === 'granted' ? <p className="text-sm text-muted">{t('schedules.notify.on')}</p> : null}
      {state === 'denied' ? <p className="text-sm text-muted">{t('schedules.notify.denied')}</p> : null}
      {state === 'default' ? <Button outline className="mt-2" type="button" onClick={async () => setState(await requestPermission())}>{t('schedules.notify.enable')}</Button> : null}
      <CheckboxField className="mt-2"><Checkbox checked={amounts} onChange={(checked) => { setAmounts(checked); allowAmounts(checked); }} /><Label>{t('schedules.notify.amounts')}</Label></CheckboxField>
      <p className="text-sm text-muted">{t('schedules.notify.amounts.hint')}</p>
    </div>
  );
}

// Reminders are shown by the ReminderService in the unlocked shell (ui/desktop), on every screen, not only here.

type Kind = 'expense' | 'income' | 'transfer';

function ScheduleForm({ row, onDone }: { row?: ScheduleRow | undefined; onDone: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const existing = row;
  const template = existing?.template;
  const firstAccount = basics.accounts.find((a) => !a.archived)?.id ?? basics.accounts[0]?.id ?? '';

  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<Kind>(template === undefined ? 'expense' : template.kind === 'transfer' ? 'transfer' : template.direction);
  const [accountId, setAccountId] = useState<string>(template?.kind === 'transaction' ? template.accountId : (template?.fromAccountId ?? firstAccount));
  const [toAccountId, setToAccountId] = useState<string>(template?.kind === 'transfer' ? template.toAccountId : (basics.accounts.find((a) => a.id !== firstAccount)?.id ?? ''));
  const account = basics.accounts.find((a) => a.id === accountId);
  const toAccount = basics.accounts.find((a) => a.id === toAccountId);
  const plain = (minor: bigint, currency: string) => formatPlain(minor, currency, locale);
  const [amount, setAmount] = useState(template === undefined || account === undefined ? '' : plain(template.kind === 'transaction' ? (template.amountMinor < 0n ? -template.amountMinor : template.amountMinor) : template.fromAmountMinor, account.currency));
  const [toAmount, setToAmount] = useState(template?.kind === 'transfer' && toAccount ? plain(template.toAmountMinor, toAccount.currency) : '');
  const [categoryId, setCategoryId] = useState<string>(template?.kind === 'transaction' ? (template.categoryId ?? '') : '');
  const [note, setNote] = useState(template?.note ?? '');
  const [begin, setBegin] = useState(dateToInput(existing?.beginLocalDate ?? todayLocal()));
  const [unit, setUnit] = useState<(typeof UNITS)[number]>(existing?.unit ?? 'month');
  const [interval, setInterval] = useState(String(existing?.interval ?? 1));
  const [end, setEnd] = useState(existing?.endLocalDate ? dateToInput(existing.endLocalDate) : '');
  const [confirm, setConfirm] = useState(existing?.requiresConfirmation ?? false);
  const [reminder, setReminder] = useState<(typeof REMINDERS)[number]>(existing?.reminderMin === null || existing === undefined ? 'none' : (String(existing.reminderMin) as (typeof REMINDERS)[number]));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const sameCurrency = kind === 'transfer' && account !== undefined && toAccount !== undefined && account.currency === toAccount.currency;
  const categories = basics.categories.filter((c) => c.direction === kind && !c.archived);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (account === undefined) return setError(t('schedules.error.account'));
    const parsed = ledger.parse(amount, account.currency);
    if (!parsed.ok) return setError(t('schedules.error.amount'));
    const beginDate = inputToDate(begin);
    if (beginDate === undefined) return setError(t('schedules.error.begin'));
    const endDate = end === '' ? null : inputToDate(end);
    if (end !== '' && endDate === undefined) return setError(t('schedules.error.end'));

    let tpl: Record<string, unknown>;
    if (kind === 'transfer') {
      if (toAccount === undefined) return setError(t('schedules.error.account'));
      const parsedTo = sameCurrency ? parsed : ledger.parse(toAmount, toAccount.currency);
      if (!parsedTo.ok) return setError(t('schedules.error.amount'));
      tpl = { kind: 'transfer', fromAccountId: account.id, toAccountId: toAccount.id, fromAmountMinor: parsed.value, toAmountMinor: parsedTo.value, note };
    } else {
      tpl = { kind: 'transaction', direction: kind, accountId: account.id, amountMinor: kind === 'expense' ? -parsed.value : parsed.value, categoryId: categoryId === '' ? null : categoryId, payeeId: template?.kind === 'transaction' ? template.payeeId : null, tagIds: template?.kind === 'transaction' ? template.tagIds : [], note };
    }
    const common = {
      name, template: tpl, unit, interval: Number(interval), beginLocalDate: beginDate, endLocalDate: endDate, requiresConfirmation: confirm,
      reminderMin: reminder === 'none' ? null : Number(reminder),
    };
    setBusy(true);
    try {
      const { template: tplValue, ...changes } = common;
      const result = existing === undefined
        ? await ledger.run('schedules.create', common)
        : await ledger.run('schedules.update', { id: existing.id, changes, template: tplValue });
      if (result.ok) onDone();
      else setError(ledger.explain(result.error.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <TextField label={t('schedules.form.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      <div className="mt-4">
        <label htmlFor="sc-kind" className="mb-3 block font-medium">{t('schedules.form.kind')}</label>
        <Select id="sc-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="expense">{t('ledger.kind.expense')}</option>
          <option value="income">{t('ledger.kind.income')}</option>
          <option value="transfer">{t('schedules.form.transfer')}</option>
        </Select>
      </div>
      <div className="mt-4">
        <label htmlFor="sc-account" className="mb-3 block font-medium">{kind === 'transfer' ? t('ledger.xfer.from') : t('schedules.form.account')}</label>
        <Select id="sc-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {basics.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </Select>
      </div>
      <AmountField label={kind === 'transfer' ? t('ledger.xfer.fromAmount') : t('schedules.form.amount')} currency={account?.currency ?? 'USD'} value={amount} onChange={setAmount} required />
      {kind === 'transfer' ? (
        <>
          <div className="mt-4">
            <label htmlFor="sc-to" className="mb-3 block font-medium">{t('ledger.xfer.to')}</label>
            <Select id="sc-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
              {basics.accounts.filter((a) => !a.archived && a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </Select>
          </div>
          {sameCurrency ? null : <AmountField label={t('ledger.xfer.toAmount')} currency={toAccount?.currency ?? 'USD'} value={toAmount} onChange={setToAmount} required />}
        </>
      ) : (
        <div className="mt-4">
          <label htmlFor="sc-category" className="mb-3 block font-medium">{t('schedules.form.category')}</label>
          <Select id="sc-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('schedules.form.noCategory')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.parentId === null ? c.name : `${basics.categories.find((p) => p.id === c.parentId)?.name ?? ''} › ${c.name}`}</option>)}
          </Select>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sc-unit" className="mb-3 block font-medium">{t('schedules.form.repeats')}</label>
          <Select id="sc-unit" value={unit} onChange={(e) => setUnit(e.target.value as (typeof UNITS)[number])}>
            {UNITS.map((u) => <option key={u} value={u}>{t(`schedules.unit.${u}`)}</option>)}
          </Select>
        </div>
        <TextField label={t('schedules.form.every')} type="number" min={1} step={1} value={interval} onChange={(e) => setInterval(e.target.value)} required />
      </div>
      <TextField label={t('schedules.form.begin')} type="date" value={begin} onChange={(e) => setBegin(e.target.value)} required />

      <Disclosure className="mt-6" title={t('schedules.form.more')} defaultOpen={existing !== undefined}>
      <TextField label={t('schedules.form.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <TextField label={t('schedules.form.end')} type="date" value={end} onChange={(e) => setEnd(e.target.value)} hint={t('schedules.form.end.hint')} />
      <CheckboxField className="mt-4"><Checkbox checked={confirm} onChange={(checked) => setConfirm(checked)} /><Label>{t('schedules.form.confirm')}</Label></CheckboxField>
      <div className="mt-4">
        <label htmlFor="sc-reminder" className="mb-3 block font-medium">{t('schedules.form.reminder')}</label>
        <Select id="sc-reminder" value={reminder} onChange={(e) => setReminder(e.target.value as (typeof REMINDERS)[number])}>
          {REMINDERS.map((r) => <option key={r} value={r}>{t(`schedules.reminder.${r}`)}</option>)}
        </Select>
      </div>
      </Disclosure>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={busy}>{existing ? t('ledger.save') : t('schedules.create')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}
