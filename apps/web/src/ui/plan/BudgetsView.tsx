'use client';

import type { BudgetRow, LocalDate } from '@cashfold/core';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../forms/Modal';
import { TextField } from '../forms/TextField';
import { Button, Checkbox, CheckboxField, Disclosure, EmptyState, FlagIcon, Label, Select, SelectOption } from '../kit';
import { useI18n } from '../i18n/I18nProvider';
import { AmountField } from '../ledger/AmountField';
import { dateToInput, formatDate, inputToDate, todayLocal } from '../ledger/dates';
import { Progress } from '../kit';
import { budgetStatus } from '../plan/status';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';
import { ITEM_ROW_CLASS, ITEM_ROW_PROPS, useFocusItem } from './item-focus';

type Mode = 'spent' | 'limit' | 'available' | 'ratio';
const MODES: readonly Mode[] = ['spent', 'limit', 'available', 'ratio'];
const UNITS = ['day', 'week', 'month', 'year', 'custom'] as const;
const ROLLOVERS = ['none', 'carry_positive', 'carry_all'] as const;

export function BudgetsView() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.budgets.title">{null}</LedgerFrame>;
  return <BudgetsBody />;
}

function BudgetsBody() {
  const { t } = useI18n();
  const ledger = useLedger();
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [mode, setMode] = useState<Mode>('available');
  const [editing, setEditing] = useState<{ row?: BudgetRow } | undefined>();
  const [viewing, setViewing] = useState<string | undefined>();
  const [removing, setRemoving] = useState<BudgetRow | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setRows(await ledger.read<BudgetRow[]>('budgets.list'));
    } catch {
      setMessage(t('ledger.error.load'));
    }
  }, [ledger.version, t]);
  useEffect(() => void load(), [load]);
  useFocusItem(rows.map((r) => r.budget.id));

  async function confirmRemove() {
    if (!removing) return;
    const r = await ledger.run('budgets.delete', { id: removing.budget.id });
    if (r.ok) setRemoving(undefined);
    else setMessage(ledger.explain(r.error.code));
  }

  const viewed = rows.find((r) => r.budget.id === viewing);

  return (
    <LedgerFrame titleKey="page.budgets.title" actions={<Button type="button" onClick={() => setEditing({})}>{t('budgets.add')}</Button>}>
      <p className="mt-3 text-muted">{t('budgets.lede')}</p>
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}
      <div className="mt-4">
        <label htmlFor="budget-mode" className="me-2 font-medium">{t('budgets.mode')}</label>
        <Select id="budget-mode" value={mode} onChange={(v) => setMode(v as Mode)}>
          {MODES.map((m) => <SelectOption key={m} value={m}>{t(`budgets.mode.${m}`)}</SelectOption>)}
        </Select>
      </div>

      {rows.length === 0 ? <EmptyState className="mt-6" icon={FlagIcon} title={t('budgets.empty')} body={t('empty.budgets.body')} action={<Button onClick={() => setEditing({})}>{t('empty.budgets.action')}</Button>} /> : null}
      <ul className="mt-4 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t('page.budgets.title')}>
        {rows.map((row) => (
          <BudgetItem key={row.budget.id} row={row} mode={mode} onOpen={() => setViewing(row.budget.id)} onEdit={() => setEditing({ row })} onDelete={() => setRemoving(row)} />
        ))}
      </ul>

      <Modal open={editing !== undefined} title={editing?.row ? t('budgets.edit') : t('budgets.add')} onClose={() => setEditing(undefined)}>
        {editing ? <BudgetForm row={editing.row} onDone={() => setEditing(undefined)} /> : null}
      </Modal>
      <Modal open={viewed !== undefined} title={viewed?.budget.name ?? ''} onClose={() => setViewing(undefined)}>
        {viewed ? <BudgetDetail row={viewed} onClose={() => setViewing(undefined)} /> : null}
      </Modal>
      <Modal open={removing !== undefined} title={t('budgets.delete.title')} onClose={() => setRemoving(undefined)}>
        {removing ? (
          <div>
            <p className="mt-3">{t('budgets.delete.explain', { name: removing.budget.name })}</p>
            <div className="mt-6 flex gap-3">
              <Button type="button" onClick={confirmRemove}>{t('ledger.delete')}</Button>
              <Button outline type="button" onClick={() => setRemoving(undefined)}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}

function BudgetItem({ row, mode, onOpen, onEdit, onDelete }: { row: BudgetRow; mode: Mode; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const { budget, period, velocity } = row;
  const money = (minor: bigint) => ledger.money(minor, budget.currency);
  const shown = period === undefined ? undefined
    : mode === 'spent' ? money(period.spentMinor)
      : mode === 'limit' ? money(period.limitMinor)
        : mode === 'available' ? money(period.availableMinor)
          : t('budgets.ratio', { spent: money(period.spentMinor), limit: money(period.allocationMinor + period.carryInMinor) });
  const status = period === undefined ? undefined : budgetStatus(period.spentMinor, period.allocationMinor + period.carryInMinor);
  const over = period !== undefined && period.availableMinor < 0n;
  return (
    <li className={`p-3 ${ITEM_ROW_CLASS}`} data-testid="budget-row" {...ITEM_ROW_PROPS(row.budget.id)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button plain type="button" onClick={onOpen}>{budget.name}</Button>
          <p className="text-sm text-muted">
            {period === undefined ? t('budgets.notStarted', { date: formatDate(budget.anchorLocalDate, locale) }) : t('budgets.period', { from: formatDate(period.from, locale), to: formatDate(period.to, locale) })}
          </p>
        </div>
        <div className="text-end">
          <strong data-testid="budget-figure">{shown ?? '—'}</strong>
          {over ? <p className="text-sm text-danger">{t('budgets.over')}</p> : null}
        </div>
      </div>
      {period !== undefined && status !== undefined ? (
        <Progress className="mt-2" value={status.progressBps} max={10_000} label={t('budgets.progress', { name: budget.name })} statusText={t(status.textKey)} tone={status.tone} />
      ) : null}
      {velocity?.overspend && budget.direction === 'expense' ? <p role="status" className="mt-2 text-sm text-danger" data-testid="budget-warning">{t('budgets.warning')}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button outline type="button" onClick={onEdit} aria-label={`${t('ledger.edit')} ${budget.name}`}>{t('ledger.edit')}</Button>
        <Button outline type="button" onClick={onDelete} aria-label={`${t('ledger.delete')} ${budget.name}`}>{t('ledger.delete')}</Button>
      </div>
    </li>
  );
}

function BudgetDetail({ row, onClose }: { row: BudgetRow; onClose: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const { budget, period, velocity } = row;
  const money = (minor: bigint) => ledger.money(minor, budget.currency);
  if (period === undefined || velocity === undefined) {
    return <div><p className="mt-3">{t('budgets.notStarted', { date: formatDate(budget.anchorLocalDate, locale) })}</p><Button outline className="mt-6" type="button" onClick={onClose}>{t('ledger.close')}</Button></div>;
  }
  const rows: Array<[string, string, string]> = [
    [t('budgets.detail.carryIn'), money(period.carryInMinor), 'carry-in'],
    [t('budgets.detail.allocation'), money(period.allocationMinor), 'allocation'],
    [t('budgets.detail.spent'), money(period.spentMinor), 'spent'],
    [t('budgets.detail.available'), money(period.availableMinor), 'available'],
    [t('budgets.detail.dailyAverage'), money(velocity.burnMinor), 'daily'],
    [t('budgets.detail.projection'), money(velocity.projectedMinor), 'projection'],
  ];
  return (
    <div>
      <p className="mt-3 text-muted">{t('budgets.period', { from: formatDate(period.from, locale), to: formatDate(period.to, locale) })}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        {rows.map(([label, value, key]) => (
          <div key={key} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-end font-medium" data-testid={`budget-${key}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {velocity.overspend ? <p role="status" className="mt-4 text-danger">{t('budgets.warning')}</p> : null}
      {period.missingRates.length > 0 ? <p role="status" className="mt-4 text-sm text-muted">{t('budgets.missingRates', { currencies: period.missingRates.join(', ') })}</p> : null}
      <Button outline className="mt-6" type="button" onClick={onClose}>{t('ledger.close')}</Button>
    </div>
  );
}

function BudgetForm({ row, onDone }: { row?: BudgetRow | undefined; onDone: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const existing = row?.budget;
  const currency = existing?.currency ?? basics.baseCurrency ?? 'USD';
  const text = (minor: bigint | undefined) => (minor === undefined ? '' : ledger.money(minor, currency).replace(/ [A-Z]{3}$/, '').replace('−', '-'));

  const [name, setName] = useState(existing?.name ?? '');
  const [direction, setDirection] = useState<'expense' | 'income'>(existing?.direction ?? 'expense');
  const [unit, setUnit] = useState<(typeof UNITS)[number]>(existing?.periodUnit ?? 'month');
  const [interval, setInterval] = useState(String(existing?.periodInterval ?? 1));
  const [anchor, setAnchor] = useState(dateToInput(existing?.anchorLocalDate ?? firstOfMonth()));
  const [end, setEnd] = useState(existing?.customEndLocalDate ? dateToInput(existing.customEndLocalDate) : '');
  const [limit, setLimit] = useState(text(existing?.limitMinor));
  const [allocation, setAllocation] = useState(existing !== undefined && existing.allocationMinor !== existing.limitMinor ? text(existing.allocationMinor) : '');
  const [rollover, setRollover] = useState<(typeof ROLLOVERS)[number]>(existing?.rollover ?? 'none');
  const [accountIds, setAccountIds] = useState<string[]>([...(existing?.scope.accountIds ?? [])]);
  const [groupIds, setGroupIds] = useState<string[]>([...(existing?.scope.groupIds ?? [])]);
  const [categoryIds, setCategoryIds] = useState<string[]>([...(existing?.scope.categoryIds ?? [])]);
  const [tagIds, setTagIds] = useState<string[]>([...(existing?.scope.tagIds ?? [])]);
  const [includeTransfers, setIncludeTransfers] = useState(existing?.scope.includeTransfers ?? false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const limitParsed = ledger.parse(limit, currency);
    if (!limitParsed.ok) return setError(t('budgets.error.limit'));
    const allocationParsed = allocation.trim() === '' ? undefined : ledger.parse(allocation, currency);
    if (allocationParsed !== undefined && !allocationParsed.ok) return setError(t('budgets.error.allocation'));
    const anchorDate = inputToDate(anchor);
    if (anchorDate === undefined) return setError(t('budgets.error.anchor'));
    const endDate = unit === 'custom' ? inputToDate(end) : undefined;
    if (unit === 'custom' && endDate === undefined) return setError(t('budgets.error.end'));
    const periodInterval = Number(interval);
    const changes = {
      name, direction, periodUnit: unit, periodInterval, anchorLocalDate: anchorDate, customEndLocalDate: unit === 'custom' ? (endDate as LocalDate) : null,
      limitMinor: limitParsed.value, ...(allocationParsed?.ok && { allocationMinor: allocationParsed.value }), rollover,
    };
    const scope = { accountIds, groupIds, categoryIds, tagIds, includeTransfers };
    setBusy(true);
    try {
      const result = existing === undefined
        ? await ledger.run('budgets.create', { ...changes, currency, scope })
        : await ledger.run('budgets.update', { id: existing.id, changes: { ...changes, ...(allocationParsed === undefined && { allocationMinor: limitParsed.value }) }, scope });
      if (result.ok) onDone();
      else setError(ledger.explain(result.error.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <TextField label={t('budgets.form.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      <div className="mt-4">
        <div>
          <label htmlFor="bg-unit" className="mb-3 block font-medium">{t('budgets.form.period')}</label>
          <Select id="bg-unit" value={unit} onChange={(v) => setUnit(v as (typeof UNITS)[number])}>
            {UNITS.map((u) => <SelectOption key={u} value={u}>{t(`budgets.unit.${u}`)}</SelectOption>)}
          </Select>
        </div>
      </div>
      <TextField label={unit === 'custom' ? t('budgets.form.start') : t('budgets.form.anchor')} type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} required />
      {unit === 'custom' ? <TextField label={t('budgets.form.end')} type="date" value={end} onChange={(e) => setEnd(e.target.value)} required /> : null}
      <AmountField label={t('budgets.form.limit')} currency={currency} value={limit} onChange={setLimit} required />


      <fieldset className="mt-6">
        <Picker
          id="bg-categories" label={t('budgets.form.categories')} value={categoryIds} onChange={setCategoryIds}
          options={basics.categories.filter((c) => c.direction === direction).map((c) => ({ id: c.id, label: c.parentId === null ? c.name : `${basics.categories.find((p) => p.id === c.parentId)?.name ?? ''} › ${c.name}` }))}
        />
      </fieldset>
      <Disclosure className="mt-6" title={t('budgets.form.more')} defaultOpen={existing !== undefined}>
      <div className="mt-4">
        <label htmlFor="bg-direction" className="mb-3 block font-medium">{t('budgets.form.direction')}</label>
        <Select id="bg-direction" value={direction} onChange={(v) => setDirection(v as 'expense' | 'income')}>
          <SelectOption value="expense">{t('ledger.kind.expense')}</SelectOption>
          <SelectOption value="income">{t('ledger.kind.income')}</SelectOption>
        </Select>
      </div>
      {unit !== 'custom' ? <TextField label={t('budgets.form.every')} type="number" min={1} step={1} value={interval} onChange={(e) => setInterval(e.target.value)} required /> : null}
      <AmountField label={t('budgets.form.allocation')} currency={currency} value={allocation} onChange={setAllocation} hint={t('budgets.form.allocation.hint')} />
      <div className="mt-4">
        <label htmlFor="bg-rollover" className="mb-3 block font-medium">{t('budgets.form.rollover')}</label>
        <Select id="bg-rollover" value={rollover} onChange={(v) => setRollover(v as (typeof ROLLOVERS)[number])}>
          {ROLLOVERS.map((r) => <SelectOption key={r} value={r}>{t(`budgets.rollover.${r}`)}</SelectOption>)}
        </Select>
      </div>
      <fieldset className="mt-6">
        <legend className="font-medium">{t('budgets.form.scope')}</legend>
        <p className="mt-1 text-sm text-muted">{t('budgets.form.scope.hint')}</p>
        <Picker id="bg-accounts" label={t('budgets.form.accounts')} options={basics.accounts.map((a) => ({ id: a.id, label: a.name }))} value={accountIds} onChange={setAccountIds} />
        <Picker id="bg-groups" label={t('budgets.form.groups')} options={basics.groups.map((g) => ({ id: g.id, label: g.name }))} value={groupIds} onChange={setGroupIds} />
        <Picker id="bg-tags" label={t('budgets.form.tags')} options={basics.tags.map((x) => ({ id: x.id, label: x.name }))} value={tagIds} onChange={setTagIds} />
        <CheckboxField className="mt-4"><Checkbox checked={includeTransfers} onChange={(checked) => setIncludeTransfers(checked)} /><Label>{t('budgets.form.transfers')}</Label></CheckboxField>
      </fieldset>
      </Disclosure>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={busy}>{existing ? t('ledger.save') : t('budgets.create')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}

function Picker({ id, label, options, value, onChange }: { id: string; label: string; options: ReadonlyArray<{ id: string; label: string }>; value: string[]; onChange: (v: string[]) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="mt-4" role="group" aria-labelledby={id}>
      <div id={id} className="mb-3 block font-medium">{label}</div>
      <div className="max-h-40 overflow-y-auto">
        {options.map((o) => (
          <CheckboxField key={o.id} className="py-1">
            <Checkbox checked={value.includes(o.id)} onChange={(checked) => onChange(checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
            <Label>{o.label}</Label>
          </CheckboxField>
        ))}
      </div>
    </div>
  );
}

function firstOfMonth(): LocalDate {
  return (Math.floor(todayLocal() / 100) * 100 + 1) as LocalDate;
}
