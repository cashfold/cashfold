'use client';

import {
  ACCOUNT_KINDS, CURRENCY_EXPONENTS, type AccountKind, type AccountRow, type DeletionSummary, type LocalDate,
} from '@cashfold/core';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { InputField, SelectField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import {
  Amount, Avatar, Badge, Button, ConfirmDialog, Disclosure, Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu, EllipsisHorizontalIcon, EmptyState, BanknotesIcon, Label, Sheet, Switch, SwitchField,
} from '../kit';
import { dateToInput, inputToDate, todayLocal } from '../ledger/dates';
import { decimalsOf, formatPlain } from '../ledger/format';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger, type Outcome } from '../ledger/LedgerProvider';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useAddSheet } from '../shell/add-context';
import { useStatus } from '../shell/StatusProvider';
import { AmountInput } from '../transactions/AmountInput';
import { GroupManager } from './GroupManager';

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

/** Accounts as cards grouped by type, with a menu per account (FR-028). */
export function AccountsScreen() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const status = useStatus();
  const { openAdd } = useAddSheet();
  const showArchived = usePrefs((p) => p.lists.showArchivedAccounts);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountRow | undefined>();
  const [adjusting, setAdjusting] = useState<AccountRow | undefined>();
  const [deleting, setDeleting] = useState<{ account: AccountRow; summary: DeletionSummary } | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const basics = ledger.basics;
  const groups = basics?.groups ?? [];
  const accounts = useMemo(() => (basics?.accounts ?? []).filter((a) => showArchived || !a.archived), [basics, showArchived]);
  const byKind = useMemo(
    () => ACCOUNT_KINDS.map((kind) => ({ kind, accounts: accounts.filter((a) => a.kind === kind) })).filter((s) => s.accounts.length > 0),
    [accounts],
  );

  const fail = (code: string) => setMessage(ledger.explain(code));

  async function archive(account: AccountRow, archived: boolean) {
    setMessage(undefined);
    const r = await ledger.run('ledger.archiveAccount', { id: account.id, archived });
    if (!r.ok) fail(r.error.code);
    else if (archived) status.notify('status.accountArchived');
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

  const none = (basics?.accounts.length ?? 0) === 0;
  return (
    <LedgerFrame titleKey="page.accounts.title" actions={<Button onClick={() => setCreating(true)}>{t('ledger.accounts.add')}</Button>}>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">{t('ledger.accounts.lede')}</p>
      {message ? <p role="alert" className="mt-3 text-(--danger)">{message}</p> : null}

      <SwitchField className="mt-4">
        <Label>{t('ledger.accounts.showArchived')}</Label>
        <Switch checked={showArchived} onChange={(on) => prefsStore.update((p) => ({ ...p, lists: { ...p.lists, showArchivedAccounts: on } }))} />
      </SwitchField>

      {none ? (
        <EmptyState className="mt-6" icon={BanknotesIcon} title={t('empty.accounts.title')} body={t('ledger.accounts.empty')} action={<Button onClick={() => setCreating(true)}>{t('empty.accounts.action')}</Button>} />
      ) : null}
      {byKind.map((section) => (
        <section key={section.kind} className="mt-6" aria-labelledby={`kind-${section.kind}`}>
          <h2 id={`kind-${section.kind}`} className="text-lg font-semibold">{t(`ledger.kind.${section.kind}`)}</h2>
          <ul className="mt-2 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10" aria-label={t(`ledger.kind.${section.kind}`)}>
            {section.accounts.map((a, index) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="account-row">
                <Avatar initials={a.name.slice(0, 1).toUpperCase()} className="size-9 shrink-0 bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white" square />
                <div className="min-w-0 flex-1 basis-40">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <Link className="truncate font-semibold underline-offset-4 hover:underline" href={`/transactions/?account=${a.id}`}>{a.name}</Link>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{a.currency}</span>
                    {a.archived ? <Badge>{t('ledger.accounts.archived')}</Badge> : null}
                    {a.includeInNetWorth ? null : <Badge>{t('ledger.accounts.excluded')}</Badge>}
                  </div>
                </div>
                <div className="text-lg" data-sign={a.balanceMinor === null ? 'zero' : a.balanceMinor > 0n ? 'gain' : a.balanceMinor < 0n ? 'loss' : 'zero'} data-testid="account-balance">
                  {a.balanceMinor === null ? t('ledger.accounts.balanceUnavailable') : <Amount minor={a.balanceMinor} currency={a.currency} locale={locale} />}
                </div>
                <Dropdown>
                  <DropdownButton plain aria-label={`${t('ledger.list.actions')} ${a.name}`}><EllipsisHorizontalIcon data-slot="icon" aria-hidden="true" /></DropdownButton>
                  <DropdownMenu anchor="bottom end">
                    <DropdownItem onClick={() => openAdd({ accountId: a.id })}><DropdownLabel>{t('ledger.tx.add')}</DropdownLabel></DropdownItem>
                    <DropdownItem onClick={() => setAdjusting(a)}><DropdownLabel>{t('ledger.accounts.adjust')}</DropdownLabel></DropdownItem>
                    <DropdownItem onClick={() => setEditing(a)}><DropdownLabel>{t('ledger.edit')}</DropdownLabel></DropdownItem>
                    <DropdownItem onClick={() => void move(section.accounts, index, -1)} disabled={index === 0}><DropdownLabel>{t('ledger.accounts.moveUp', { name: a.name })}</DropdownLabel></DropdownItem>
                    <DropdownItem onClick={() => void move(section.accounts, index, 1)} disabled={index === section.accounts.length - 1}><DropdownLabel>{t('ledger.accounts.moveDown', { name: a.name })}</DropdownLabel></DropdownItem>
                    <DropdownItem onClick={() => void archive(a, !a.archived)}><DropdownLabel>{a.archived ? t('ledger.accounts.unarchive') : t('ledger.accounts.archive')}</DropdownLabel></DropdownItem>
                    <DropdownItem onClick={() => void askDelete(a)}><DropdownLabel>{t('ledger.delete')}</DropdownLabel></DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <GroupManager />

      {creating ? <AccountSheet
        open title={t('ledger.accounts.add')} submitLabel={t('ledger.accounts.create')} onClose={() => setCreating(false)} creating
        initial={{ name: '', kind: 'checking', currency: ledger.fold?.baseCurrency ?? 'USD', opening: '', openingDate: dateToInput(todayLocal()), limit: '', inNetWorth: true, group: '' }}
        onSubmit={async (values) => {
          const input = toInput(values, ledger.parse, t);
          if (!input.ok) return input.error;
          const r = await ledger.run<{ id: string }>('ledger.createAccount', input.value);
          if (!r.ok) return ledger.explain(r.error.code);
          if (values.group !== '') await ledger.run('ledger.groupAccounts', { group: values.group, accounts: [r.value.id], member: true });
          setCreating(false);
          status.notify('status.accountSaved');
          return undefined;
        }}
      /> : null}

      {editing ? (
        <AccountSheet
          key={editing.id} open title={t('ledger.accounts.edit', { name: editing.name })} submitLabel={t('ledger.accounts.save')} onClose={() => setEditing(undefined)}
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
            status.notify('status.accountSaved');
            return undefined;
          }}
        />
      ) : null}

      {adjusting ? <AdjustSheet account={adjusting} onDone={() => setAdjusting(undefined)} /> : null}

      <ConfirmDialog
        open={deleting !== undefined} destructive title={t('ledger.accounts.delete.title', { name: deleting?.account.name ?? '' })}
        body={deleting ? t('ledger.accounts.delete.consequence', { transactions: deleting.summary.transactions, transfers: deleting.summary.transfers }) : undefined}
        confirmLabel={t('ledger.accounts.delete.confirm')} cancelLabel={t('ledger.cancel')} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(undefined)}
      />
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

function AccountSheet({ open, title, submitLabel, initial, creating = false, onSubmit, onClose }: {
  open: boolean; title: string; submitLabel: string; initial: FormState; creating?: boolean; onClose: () => void; onSubmit: (values: FormState) => Promise<string | undefined>;
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
    <Sheet
      open={open} onClose={onClose} title={title}
      footer={<><Button plain type="button" onClick={onClose}>{t('ledger.cancel')}</Button><Button type="submit" form="account-form" disabled={busy}>{submitLabel}</Button></>}
    >
      <form id="account-form" onSubmit={submit} className="space-y-4">
        <InputField label={t('ledger.accounts.form.name')} value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} autoFocus />
        <SelectField label={t('ledger.accounts.form.kind')} value={v.kind} onChange={(e) => set('kind', e.target.value as AccountKind)}>
          {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`ledger.kind.${k}`)}</option>)}
        </SelectField>
        <SelectField label={t('ledger.accounts.form.currency')} value={v.currency} onChange={(e) => set('currency', e.target.value)} disabled={!creating}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </SelectField>
        <AmountInput label={t('ledger.accounts.form.opening')} currency={v.currency} value={v.opening} onChange={(x) => set('opening', x)} />
        <Disclosure title={t('ledger.accounts.moreOptions')} defaultOpen={!creating}>
          <div className="space-y-4">
            <InputField label={t('ledger.accounts.form.openingDate')} type="date" value={v.openingDate} onChange={(e) => set('openingDate', e.target.value)} required />
            {HAS_LIMIT.has(v.kind) ? <AmountInput label={t('ledger.accounts.form.limit')} currency={v.currency} value={v.limit} onChange={(x) => set('limit', x)} /> : null}
            {ledger.basics && ledger.basics.groups.length > 0 ? (
              <SelectField label={t('ledger.accounts.form.group')} value={v.group} onChange={(e) => set('group', e.target.value)}>
                <option value="">{t('ledger.accounts.ungrouped')}</option>
                {ledger.basics.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </SelectField>
            ) : null}
            <SwitchField><Label>{t('ledger.accounts.form.inNetWorth')}</Label><Switch checked={v.inNetWorth} onChange={(on) => set('inNetWorth', on)} /></SwitchField>
          </div>
        </Disclosure>
        {error ? <p role="alert" className="text-(--danger)">{error}</p> : null}
      </form>
    </Sheet>
  );
}

function AdjustSheet({ account, onDone }: { account: AccountRow; onDone: () => void }) {
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
    <Sheet
      open onClose={onDone} title={t('ledger.accounts.adjust.title', { name: account.name })} description={t('ledger.accounts.adjust.explain')}
      footer={<><Button plain type="button" onClick={onDone}>{t('ledger.cancel')}</Button><Button type="submit" form="adjust-form">{t('ledger.accounts.adjust.submit')}</Button></>}
    >
      <form id="adjust-form" onSubmit={submit} className="space-y-4">
        <AmountInput label={t('ledger.accounts.adjust.target')} currency={account.currency} value={target} onChange={setTarget} autoFocus />
        <InputField label={t('ledger.accounts.adjust.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {error ? <p role="alert" className="text-(--danger)">{error}</p> : null}
      </form>
    </Sheet>
  );
}
