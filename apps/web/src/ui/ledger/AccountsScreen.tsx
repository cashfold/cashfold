'use client';

import {
  ACCOUNT_KINDS, CURRENCY_EXPONENTS, type AccountKind, type AccountRow, type DeletionSummary, type LocalDate,
} from '@cashfold/core';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '../forms/Modal';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { AmountField } from './AmountField';
import { dateToInput, inputToDate, todayLocal } from './dates';
import { decimalsOf, formatPlain, signOf } from './format';
import { LedgerFrame } from './LedgerFrame';
import { useLedger, type Outcome } from './LedgerProvider';

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS).sort();
const HAS_LIMIT: ReadonlySet<AccountKind> = new Set(['credit_card', 'loan']);

interface FormState {
  name: string;
  kind: AccountKind;
  currency: string;
  opening: string;
  openingDate: string;
  limit: string;
  inNetWorth: boolean;
  group: string;
}

export function AccountsScreen() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountRow | undefined>();
  const [adjusting, setAdjusting] = useState<AccountRow | undefined>();
  const [deleting, setDeleting] = useState<{ account: AccountRow; summary: DeletionSummary } | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const basics = ledger.basics;
  const groups = basics?.groups ?? [];
  const accounts = useMemo(() => (basics?.accounts ?? []).filter((a) => showArchived || !a.archived), [basics, showArchived]);
  const byGroup = useMemo(() => {
    const sections: Array<{ key: string; name: string; accounts: AccountRow[] }> = [];
    for (const g of groups) sections.push({ key: g.id, name: g.name, accounts: accounts.filter((a) => a.groupIds.includes(g.id)) });
    const ungrouped = accounts.filter((a) => !a.groupIds.some((id) => groups.some((g) => g.id === id)));
    if (ungrouped.length > 0 || groups.length === 0) sections.push({ key: 'none', name: t('ledger.accounts.ungrouped'), accounts: ungrouped });
    return sections.filter((s) => s.accounts.length > 0 || s.key !== 'none');
  }, [groups, accounts, t]);

  const fail = (code: string) => setMessage(ledger.explain(code));

  async function archive(account: AccountRow, archived: boolean) {
    setMessage(undefined);
    const r = await ledger.run('ledger.archiveAccount', { id: account.id, archived });
    if (!r.ok) fail(r.error.code);
  }

  /** Swaps an account with its neighbour by renumbering the whole visible list, so equal positions cannot stall a move. */
  async function move(section: AccountRow[], index: number, delta: -1 | 1) {
    const order = [...section];
    const other = index + delta;
    if (other < 0 || other >= order.length) return;
    [order[index], order[other]] = [order[other]!, order[index]!];
    for (const [position, account] of order.entries()) {
      if (account.sortOrder !== position) await ledger.run('ledger.updateAccount', { id: account.id, changes: { sortOrder: position } });
    }
  }

  async function askDelete(account: AccountRow) {
    setMessage(undefined);
    try {
      const summary = await ledger.read<DeletionSummary | undefined>('ledger.accountDeletion', { id: account.id });
      if (summary !== undefined) setDeleting({ account, summary });
    } catch {
      setMessage(t('ledger.error.generic'));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const r = await ledger.run('ledger.deleteAccount', { id: deleting.account.id, confirm: true });
    if (r.ok) setDeleting(undefined);
    else fail(r.error.code);
  }

  return (
    <LedgerFrame titleKey="page.accounts.title" actions={<button type="button" className={buttonClass} onClick={() => setCreating(true)}>{t('ledger.accounts.add')}</button>}>
      <p className="mt-3 text-muted">{t('ledger.accounts.lede')}</p>
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}

      <label className="mt-4 flex items-center gap-2">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('ledger.accounts.showArchived')}
      </label>

      {(basics?.accounts.length ?? 0) === 0 ? <p className="mt-6 text-muted">{t('ledger.accounts.empty')}</p> : null}
      {byGroup.map((section) => (
        <section key={section.key} className="mt-6" aria-labelledby={`group-${section.key}`}>
          <h2 id={`group-${section.key}`} className="text-lg font-semibold">{section.name}</h2>
          {section.accounts.length === 0 ? <p className="mt-2 text-muted">{t('ledger.accounts.groupEmpty')}</p> : null}
          <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong" aria-label={section.name}>
            {section.accounts.map((a, index) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="account-row">
                <div>
                  <Link className="font-semibold underline-offset-4 hover:underline" href={`/transactions/?account=${a.id}`}>{a.name}</Link>
                  <span className="ms-3 text-sm text-muted">{t(`ledger.kind.${a.kind}`)} · {a.currency}</span>
                  {a.archived ? <span className="ms-2 rounded-ui border border-border-strong px-2 text-sm">{t('ledger.accounts.archived')}</span> : null}
                  {a.includeInNetWorth ? null : <span className="ms-2 rounded-ui border border-border-strong px-2 text-sm">{t('ledger.accounts.excluded')}</span>}
                  <div className="mt-1 text-lg" data-sign={a.balanceMinor === null ? 'zero' : signOf(a.balanceMinor)} data-testid="account-balance">
                    {a.balanceMinor === null ? t('ledger.accounts.balanceUnavailable') : ledger.money(a.balanceMinor, a.currency)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={secondaryButtonClass} onClick={() => void move(section.accounts, index, -1)} disabled={index === 0} aria-label={t('ledger.accounts.moveUp', { name: a.name })}>↑</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => void move(section.accounts, index, 1)} disabled={index === section.accounts.length - 1} aria-label={t('ledger.accounts.moveDown', { name: a.name })}>↓</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setEditing(a)} aria-label={`${t('ledger.edit')} ${a.name}`}>{t('ledger.edit')}</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setAdjusting(a)} aria-label={`${t('ledger.accounts.adjust')} ${a.name}`}>{t('ledger.accounts.adjust')}</button>
                  <button type="button" className={secondaryButtonClass} onClick={() => void archive(a, !a.archived)} aria-label={`${a.archived ? t('ledger.accounts.unarchive') : t('ledger.accounts.archive')} ${a.name}`}>
                    {a.archived ? t('ledger.accounts.unarchive') : t('ledger.accounts.archive')}
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={() => void askDelete(a)} aria-label={`${t('ledger.delete')} ${a.name}`}>{t('ledger.delete')}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <GroupManager />

      <Modal open={creating} title={t('ledger.accounts.add')} onClose={() => setCreating(false)}>
        <AccountForm
          submitLabel={t('ledger.accounts.create')} onCancel={() => setCreating(false)}
          initial={{ name: '', kind: 'checking', currency: ledger.fold?.baseCurrency ?? 'USD', opening: '', openingDate: dateToInput(todayLocal()), limit: '', inNetWorth: true, group: '' }}
          onSubmit={async (values) => {
            const input = toInput(values, ledger.parse, t);
            if (!input.ok) return input.error;
            const r = await ledger.run<{ id: string }>('ledger.createAccount', input.value);
            if (!r.ok) return ledger.explain(r.error.code);
            if (values.group !== '') await ledger.run('ledger.groupAccounts', { group: values.group, accounts: [r.value.id], member: true });
            setCreating(false);
            return undefined;
          }}
        />
      </Modal>

      <Modal open={editing !== undefined} title={t('ledger.accounts.edit', { name: editing?.name ?? '' })} onClose={() => setEditing(undefined)}>
        {editing ? (
          <AccountForm
            key={editing.id} submitLabel={t('ledger.accounts.save')} onCancel={() => setEditing(undefined)}
            initial={{
              name: editing.name, kind: editing.kind, currency: editing.currency, opening: formatPlain(editing.openingBalanceMinor, editing.currency, locale),
              openingDate: dateToInput(editing.openingDate), limit: editing.creditLimitMinor === null ? '' : formatPlain(editing.creditLimitMinor, editing.currency, locale),
              inNetWorth: editing.includeInNetWorth, group: editing.groupIds.find((g) => groups.some((x) => x.id === g)) ?? '',
            }}
            onSubmit={async (values) => {
              const input = toInput(values, ledger.parse, t);
              if (!input.ok) return input.error;
              const { kind, name, currency, openingBalanceMinor, openingDate, includeInNetWorth, creditLimitMinor } = input.value;
              const r = await ledger.run('ledger.updateAccount', { id: editing.id, changes: { kind, name, currency, openingBalanceMinor, openingDate, includeInNetWorth, creditLimitMinor } });
              if (!r.ok) return ledger.explain(r.error.code);
              const before = editing.groupIds.find((g) => groups.some((x) => x.id === g)) ?? '';
              if (before !== values.group) {
                if (before !== '') await ledger.run('ledger.groupAccounts', { group: before, accounts: [editing.id], member: false });
                if (values.group !== '') await ledger.run('ledger.groupAccounts', { group: values.group, accounts: [editing.id], member: true });
              }
              setEditing(undefined);
              return undefined;
            }}
          />
        ) : null}
      </Modal>

      <Modal open={adjusting !== undefined} title={t('ledger.accounts.adjust.title', { name: adjusting?.name ?? '' })} onClose={() => setAdjusting(undefined)}>
        {adjusting ? <AdjustForm account={adjusting} onDone={() => setAdjusting(undefined)} /> : null}
      </Modal>

      <Modal open={deleting !== undefined} title={t('ledger.accounts.delete.title', { name: deleting?.account.name ?? '' })} onClose={() => setDeleting(undefined)}>
        {deleting ? (
          <div>
            <p className="mt-3">{t('ledger.accounts.delete.consequence', { transactions: deleting.summary.transactions, transfers: deleting.summary.transfers })}</p>
            <div className="mt-6 flex gap-3">
              <button type="button" className={buttonClass} onClick={() => void confirmDelete()}>{t('ledger.accounts.delete.confirm')}</button>
              <button type="button" className={secondaryButtonClass} onClick={() => setDeleting(undefined)}>{t('ledger.cancel')}</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}

type Parse = ReturnType<typeof useLedger>['parse'];
type Translate = ReturnType<typeof useI18n>['t'];

function toInput(values: FormState, parse: Parse, t: Translate): { ok: true; value: { name: string; kind: AccountKind; currency: string; openingBalanceMinor: bigint; openingDate: LocalDate; includeInNetWorth: boolean; creditLimitMinor: bigint | null } } | { ok: false; error: string } {
  const date = inputToDate(values.openingDate);
  const amountProblem = (code: string) => t(`ledger.amount.${code}`, { decimals: decimalsOf(values.currency), currency: values.currency });
  if (date === undefined) return { ok: false, error: t('ledger.accounts.form.date') };
  const opening = values.opening.trim() === '' ? { ok: true as const, value: 0n } : parse(values.opening, values.currency);
  if (!opening.ok) return { ok: false, error: amountProblem(opening.error.code) };
  let creditLimitMinor: bigint | null = null;
  if (HAS_LIMIT.has(values.kind) && values.limit.trim() !== '') {
    const limit = parse(values.limit, values.currency);
    if (!limit.ok) return { ok: false, error: amountProblem(limit.error.code) };
    creditLimitMinor = limit.value;
  }
  return { ok: true, value: { name: values.name, kind: values.kind, currency: values.currency, openingBalanceMinor: opening.value, openingDate: date, includeInNetWorth: values.inNetWorth, creditLimitMinor } };
}

function AccountForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: FormState; submitLabel: string; onCancel: () => void; onSubmit: (values: FormState) => Promise<string | undefined>;
}) {
  const { t } = useI18n();
  const ledger = useLedger();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setV((s) => ({ ...s, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const problem = await onSubmit(v);
    setBusy(false);
    setError(problem);
  }

  return (
    <form onSubmit={submit}>
      <TextField label={t('ledger.accounts.form.name')} value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} autoFocus />
      <div className="mt-4">
        <label htmlFor="acct-kind" className="block font-medium">{t('ledger.accounts.form.kind')}</label>
        <select id="acct-kind" className="mt-1 block rounded-ui border border-border-strong bg-bg px-3 py-2" value={v.kind} onChange={(e) => set('kind', e.target.value as AccountKind)}>
          {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`ledger.kind.${k}`)}</option>)}
        </select>
      </div>
      <div className="mt-4">
        <label htmlFor="acct-currency" className="block font-medium">{t('ledger.accounts.form.currency')}</label>
        <select id="acct-currency" className="mt-1 block rounded-ui border border-border-strong bg-bg px-3 py-2" value={v.currency} onChange={(e) => set('currency', e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <AmountField label={t('ledger.accounts.form.opening')} currency={v.currency} value={v.opening} onChange={(x) => set('opening', x)} />
      <TextField label={t('ledger.accounts.form.openingDate')} type="date" value={v.openingDate} onChange={(e) => set('openingDate', e.target.value)} required />
      {HAS_LIMIT.has(v.kind) ? <AmountField label={t('ledger.accounts.form.limit')} currency={v.currency} value={v.limit} onChange={(x) => set('limit', x)} /> : null}
      {ledger.basics && ledger.basics.groups.length > 0 ? (
        <div className="mt-4">
          <label htmlFor="acct-group" className="block font-medium">{t('ledger.accounts.form.group')}</label>
          <select id="acct-group" className="mt-1 block rounded-ui border border-border-strong bg-bg px-3 py-2" value={v.group} onChange={(e) => set('group', e.target.value)}>
            <option value="">{t('ledger.accounts.ungrouped')}</option>
            {ledger.basics.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      ) : null}
      <label className="mt-4 flex items-center gap-2">
        <input type="checkbox" checked={v.inNetWorth} onChange={(e) => set('inNetWorth', e.target.checked)} />
        {t('ledger.accounts.form.inNetWorth')}
      </label>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="submit" className={buttonClass} disabled={busy}>{submitLabel}</button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>{t('ledger.cancel')}</button>
      </div>
    </form>
  );
}

function AdjustForm({ account, onDone }: { account: AccountRow; onDone: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const [target, setTarget] = useState('');
  const [date, setDate] = useState(dateToInput(todayLocal()));
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const when = inputToDate(date);
    const parsed = ledger.parse(target, account.currency);
    if (when === undefined || !parsed.ok) return setError(t('ledger.accounts.adjust.invalid'));
    const r: Outcome<unknown> = await ledger.run('ledger.adjustBalance', { accountId: account.id, target: parsed.value, date: when });
    if (r.ok) onDone();
    else setError(ledger.explain(r.error.code));
  }

  return (
    <form onSubmit={submit}>
      <p className="mt-3">{t('ledger.accounts.adjust.explain')}</p>
      <AmountField label={t('ledger.accounts.adjust.target')} currency={account.currency} value={target} onChange={setTarget} required />
      <TextField label={t('ledger.accounts.adjust.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="submit" className={buttonClass}>{t('ledger.accounts.adjust.submit')}</button>
        <button type="button" className={secondaryButtonClass} onClick={onDone}>{t('ledger.cancel')}</button>
      </div>
    </form>
  );
}

function GroupManager() {
  const { t } = useI18n();
  const ledger = useLedger();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const groups = ledger.basics?.groups ?? [];

  async function create(event: FormEvent) {
    event.preventDefault();
    const r = await ledger.run('ledger.createGroup', { name });
    if (r.ok) {
      setName('');
      setError(undefined);
    } else setError(ledger.explain(r.error.code));
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const r = await ledger.run('ledger.updateGroup', { id: renaming.id, name: renaming.name });
    if (r.ok) setRenaming(undefined);
    else setError(ledger.explain(r.error.code));
  }

  return (
    <details className="mt-8">
      <summary className="cursor-pointer text-lg font-semibold">{t('ledger.groups.title')}</summary>
      <p className="mt-2 text-muted">{t('ledger.groups.lede')}</p>
      <ul className="mt-2" aria-label={t('ledger.groups.title')}>
        {groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-2 py-1">
            {renaming?.id === g.id ? (
              <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
                <TextField label={t('ledger.groups.name')} value={renaming.name} onChange={(e) => setRenaming({ id: g.id, name: e.target.value })} autoFocus />
                <button type="submit" className={buttonClass}>{t('ledger.save')}</button>
                <button type="button" className={secondaryButtonClass} onClick={() => setRenaming(undefined)}>{t('ledger.cancel')}</button>
              </form>
            ) : (
              <>
                <span>{g.name}</span>
                <button type="button" className={secondaryButtonClass} onClick={() => setRenaming({ id: g.id, name: g.name })} aria-label={`${t('ledger.edit')} ${g.name}`}>{t('ledger.edit')}</button>
                <button type="button" className={secondaryButtonClass} onClick={() => void ledger.run('ledger.deleteGroup', { id: g.id })} aria-label={`${t('ledger.delete')} ${g.name}`}>{t('ledger.delete')}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="max-w-md">
        <TextField label={t('ledger.groups.new')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
        <button type="submit" className={`${buttonClass} mt-3`}>{t('ledger.groups.create')}</button>
      </form>
    </details>
  );
}
