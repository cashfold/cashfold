'use client';

import type { GoalRow } from '@cashfold/core';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../forms/Modal';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { Progress } from '../kit';
import { Button, EmptyState, FlagIcon } from '../kit';
import { useI18n } from '../i18n/I18nProvider';
import { AmountField } from '../ledger/AmountField';
import { dateToInput, formatDate, inputToDate, todayLocal } from '../ledger/dates';
import { formatPlain } from '../ledger/format';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';
import { COLOR_COUNT, colorFor } from '../ledger/palette';

const select = 'mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2';

export function GoalsScreen() {
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

  const free = basics.accounts.filter((a) => a.kind === 'goal' && !a.archived && !rows.some((r) => r.goal.accountId === a.id));

  return (
    <LedgerFrame titleKey="page.goals.title" actions={<button type="button" className={buttonClass} onClick={() => setEditing({})} disabled={free.length === 0}>{t('goals.add')}</button>}>
      <p className="mt-3 text-muted">{t('goals.lede')}</p>
      {free.length === 0 && rows.length === 0 ? <p className="mt-3" data-testid="goals-need-account">{t('goals.needAccount')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}
      {rows.length === 0 && free.length > 0 ? <EmptyState className="mt-6" icon={FlagIcon} title={t('goals.empty')} body={t('empty.goals.body')} action={<Button onClick={() => setEditing({})}>{t('empty.goals.action')}</Button>} /> : null}
      <ul className="mt-4 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('page.goals.title')}>
        {rows.map((row) => {
          const { goal, progress } = row;
          const money = (minor: bigint) => ledger.money(minor, goal.currency);
          return (
            <li key={goal.id} className="p-3" data-testid="goal-row">
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
                <button type="button" className={secondaryButtonClass} onClick={() => setEditing({ row })} aria-label={`${t('ledger.edit')} ${goal.name}`}>{t('ledger.edit')}</button>
                <button type="button" className={secondaryButtonClass} onClick={() => setRemoving(row)} aria-label={`${t('ledger.delete')} ${goal.name}`}>{t('ledger.delete')}</button>
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
              <button
                type="button" className={buttonClass}
                onClick={async () => {
                  const r = await ledger.run('goals.delete', { id: removing.goal.id });
                  if (r.ok) setRemoving(undefined);
                  else setMessage(ledger.explain(r.error.code));
                }}
              >{t('ledger.delete')}</button>
              <button type="button" className={secondaryButtonClass} onClick={() => setRemoving(undefined)}>{t('ledger.cancel')}</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}

function GoalForm({ row, free, onDone }: { row?: GoalRow | undefined; free: ReadonlyArray<{ id: string; name: string; currency: string }>; onDone: () => void }) {
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
        <label htmlFor="goal-account" className="block font-medium">{t('goals.form.account')}</label>
        <select id="goal-account" className={select} value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </div>
      <AmountField label={t('goals.form.target')} currency={currency} value={target} onChange={setTarget} required />
      <TextField label={t('goals.form.date')} type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      <div className="mt-4">
        <label htmlFor="goal-color" className="block font-medium">{t('ledger.categories.form.color')}</label>
        <select id="goal-color" className={select} value={color} onChange={(e) => setColor(Number(e.target.value))}>
          {Array.from({ length: COLOR_COUNT }, (_, i) => <option key={i} value={i}>{t(`ledger.color.${i}`)}</option>)}
        </select>
      </div>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="submit" className={buttonClass} disabled={busy}>{existing ? t('ledger.save') : t('goals.create')}</button>
        <button type="button" className={secondaryButtonClass} onClick={onDone}>{t('ledger.cancel')}</button>
      </div>
    </form>
  );
}
