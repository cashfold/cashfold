'use client';

import type { AccountRow, GoalRow } from '@cashfold/core';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../forms/Modal';
import { TextField } from '../forms/TextField';
import { Amount, Button, EmptyState, FlagIcon, Progress, Select, SelectOption } from '../kit';
import { useI18n } from '../i18n/I18nProvider';
import { AmountField } from '../ledger/AmountField';
import { dateToInput, formatDate, inputToDate, todayLocal } from '../ledger/dates';
import { formatPlain } from '../ledger/format';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';
import { COLOR_COUNT, colorFor } from '../ledger/palette';
import { ITEM_ROW_CLASS, ITEM_ROW_PROPS, useFocusItem } from './item-focus';
import { AccountOption } from '../accounts/AccountOption';


export function GoalsView() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.goals.title">{null}</LedgerFrame>;
  return <GoalsBody />;
}

function GoalsBody() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [editing, setEditing] = useState<{ row?: GoalRow } | undefined>();
  const [removing, setRemoving] = useState<GoalRow | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setRows(await ledger.read<GoalRow[]>('goals.progress'));
    } catch {
      setMessage(t('ledger.error.load'));
    }
  }, [ledger.version, t]);
  useEffect(() => void load(), [load]);
  useFocusItem(rows.map((r) => r.goal.id));

  const free = basics.accounts.filter((a) => a.kind === 'goal' && !a.archived && !rows.some((r) => r.goal.accountId === a.id));

  return (
    <LedgerFrame titleKey="page.goals.title" actions={<Button type="button" onClick={() => setEditing({})} disabled={free.length === 0}>{t('goals.add')}</Button>}>
      <p className="mt-3 text-muted">{t('goals.lede')}</p>
      {free.length === 0 && rows.length === 0 ? <p className="mt-3" data-testid="goals-need-account">{t('goals.needAccount')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}
      {rows.length === 0 && free.length > 0 ? <EmptyState className="mt-6" icon={FlagIcon} title={t('goals.empty')} body={t('empty.goals.body')} action={<Button onClick={() => setEditing({})}>{t('empty.goals.action')}</Button>} /> : null}
      <ul className="mt-4 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('page.goals.title')}>
        {rows.map((row) => {
          const { goal, progress } = row;
          const money = (minor: bigint) => <Amount minor={minor} currency={goal.currency} locale={locale} />;
          return (
            <li key={goal.id} className={`p-3 ${ITEM_ROW_CLASS}`} data-testid="goal-row" {...ITEM_ROW_PROPS(goal.id)}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span aria-hidden="true" className="me-2 inline-block h-3 w-3 rounded-ui" style={{ background: colorFor(goal.color) }} />
                  <strong>{goal.name}</strong>
                  <p className="text-sm text-muted">{t('goals.due', { date: formatDate(goal.targetLocalDate, locale), account: row.accountName ?? t('goals.noAccount') })}</p>
                </div>
                {progress ? <span data-testid="goal-status" className="font-medium">{t(`goals.status.${progress.status}`)}</span> : <span className="text-muted">{t('goals.noProgress')}</span>}
              </div>
              {progress ? (
                <>
                  <Progress className="mt-2" value={progress.percent} max={100} label={t('goals.progress', { name: goal.name })} statusText={t(`goals.status.${progress.status}`)} tone={progress.status === 'achieved' ? 'good' : progress.status === 'overdue' ? 'danger' : 'neutral'} />
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                    <div><dt className="text-sm text-muted">{t('goals.saved')}</dt><dd data-testid="goal-saved">{money(progress.savedMinor)}</dd></div>
                    <div><dt className="text-sm text-muted">{t('goals.remaining')}</dt><dd data-testid="goal-remaining">{money(progress.remainingMinor)}</dd></div>
                    <div><dt className="text-sm text-muted">{t('goals.percent')}</dt><dd data-testid="goal-percent">{t('goals.percentValue', { percent: progress.percent })}</dd></div>
                    <div><dt className="text-sm text-muted">{t('goals.perMonth')}</dt><dd data-testid="goal-monthly">{progress.status === 'achieved' ? '—' : money(progress.requiredPerMonthMinor)}</dd></div>
                  </dl>
                </>
              ) : null}
              {row.missingRates.length > 0 ? <p role="status" className="mt-2 text-sm text-muted">{t('goals.missingRates', { currencies: row.missingRates.join(', ') })}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button outline type="button" onClick={() => setEditing({ row })} aria-label={`${t('ledger.edit')} ${goal.name}`}>{t('ledger.edit')}</Button>
                <Button outline type="button" onClick={() => setRemoving(row)} aria-label={`${t('ledger.delete')} ${goal.name}`}>{t('ledger.delete')}</Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal open={editing !== undefined} title={editing?.row ? t('goals.edit') : t('goals.add')} onClose={() => setEditing(undefined)}>
        {editing ? <GoalForm row={editing.row} free={free} onDone={() => setEditing(undefined)} /> : null}
      </Modal>
      <Modal open={removing !== undefined} title={t('goals.delete.title')} onClose={() => setRemoving(undefined)}>
        {removing ? (
          <div>
            <p className="mt-3">{t('goals.delete.explain', { name: removing.goal.name })}</p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button" 
                onClick={async () => {
                  const r = await ledger.run('goals.delete', { id: removing.goal.id });
                  if (r.ok) setRemoving(undefined);
                  else setMessage(ledger.explain(r.error.code));
                }}
              >{t('ledger.delete')}</Button>
              <Button outline type="button" onClick={() => setRemoving(undefined)}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}

function GoalForm({ row, free, onDone }: { row?: GoalRow | undefined; free: readonly AccountRow[]; onDone: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const existing = row?.goal;
  const options = existing === undefined ? free : [...basics.accounts.filter((a) => a.id === existing.accountId), ...free];
  const [name, setName] = useState(existing?.name ?? '');
  const [accountId, setAccountId] = useState<string>(existing?.accountId ?? options[0]?.id ?? '');
  const account = basics.accounts.find((a) => a.id === accountId);
  const currency = existing?.currency ?? account?.currency ?? basics.baseCurrency ?? 'USD';
  const [target, setTarget] = useState(existing === undefined ? '' : formatPlain(existing.targetMinor, existing.currency, locale));
  const [due, setDue] = useState(dateToInput(existing?.targetLocalDate ?? todayLocal()));
  const [color, setColor] = useState(existing?.color ?? 0);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const parsed = ledger.parse(target, currency);
    if (!parsed.ok) return setError(t('goals.error.target'));
    const date = inputToDate(due);
    if (date === undefined) return setError(t('goals.error.date'));
    const changes = { name, targetMinor: parsed.value, currency, targetLocalDate: date, accountId, color };
    setBusy(true);
    try {
      const result = existing === undefined ? await ledger.run('goals.create', changes) : await ledger.run('goals.update', { id: existing.id, changes });
      if (result.ok) onDone();
      else setError(ledger.explain(result.error.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <TextField label={t('goals.form.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      <div className="mt-4">
        <label htmlFor="goal-account" className="mb-3 block font-medium">{t('goals.form.account')}</label>
        <Select id="goal-account" value={accountId} onChange={setAccountId}>
          {options.map((a) => <AccountOption key={a.id} account={a} />)}
        </Select>
      </div>
      <AmountField label={t('goals.form.target')} currency={currency} value={target} onChange={setTarget} required />
      <TextField label={t('goals.form.date')} type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      <div className="mt-4">
        <label htmlFor="goal-color" className="mb-3 block font-medium">{t('ledger.categories.form.color')}</label>
        <Select id="goal-color" value={color} onChange={setColor}>
          {Array.from({ length: COLOR_COUNT }, (_, i) => <SelectOption key={i} value={i}>{t(`ledger.color.${i}`)}</SelectOption>)}
        </Select>
      </div>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={busy}>{existing ? t('ledger.save') : t('goals.create')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}
