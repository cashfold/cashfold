'use client';

import {
  ACCOUNT_KINDS, CURRENCY_EXPONENTS, type AccountGroup, type AccountKind, type AccountRow, type DeletionSummary, type LocalDate,
} from '@cashfold/core';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { InputField, SelectField } from '../forms/Field';
import { useRowContextMenu } from '../desktop/ContextMenu';
import { usePrivacy } from '../privacy/usePrivacy';
import { useI18n } from '../i18n/I18nProvider';
import { Amount, Avatar, Badge, Button, ConfirmDialog, Disclosure, EmptyState, BanknotesIcon, Label, Sheet, Switch, SwitchField, SelectOption } from '../kit';
import { dateToInput, inputToDate, todayLocal } from '../ledger/dates';
import { decimalsOf, formatPlain } from '../ledger/format';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger, type Outcome } from '../ledger/LedgerProvider';
import { RowActionsMenu } from '../ledger/RowActionsMenu';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { useAddSheet } from '../shell/add-context';
import { useStatus } from '../shell/StatusProvider';
import { AmountInput } from '../transactions/AmountInput';
import { accountActions } from './account-actions';
import { moveWithin } from './account-order';
import { accountSections, groupOf, type AccountSection } from './account-sections';
import { effectiveView } from './accounts-view';
import { AccountsViewSwitch } from './AccountsViewSwitch';
import { GroupDeleteDialog, GroupFormDialog } from './GroupDialogs';
import { GroupManager } from './GroupManager';
import { GroupSection } from './GroupSection';

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

/** Accounts as cards grouped by group or by type, with a menu per account (FR-028). */
export function AccountsScreen() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const status = useStatus();
  const { openAdd } = useAddSheet();
  const showArchived = usePrefs((p) => p.lists.showArchivedAccounts);
  const viewPref = usePrefs((p) => p.lists.accountsView);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountRow | undefined>();
  const [adjusting, setAdjusting] = useState<AccountRow | undefined>();
  const [deleting, setDeleting] = useState<{ account: AccountRow; summary: DeletionSummary } | undefined>();
  const [groupForm, setGroupForm] = useState<AccountGroup | 'new' | undefined>();
  const [groupDelete, setGroupDelete] = useState<AccountGroup | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const afterMove = useRef<{ account: string } | undefined>(undefined);

  const basics = ledger.basics;
  const groups = useMemo(() => basics?.groups ?? [], [basics]);
  const accounts = useMemo(() => (basics?.accounts ?? []).filter((a) => showArchived || !a.archived), [basics, showArchived]);
  const view = effectiveView(viewPref, basics?.accounts ?? [], groups);
  const sections = useMemo(() => accountSections({ accounts, groups, view }), [accounts, groups, view]);

  // After a move the account's row is drawn again in its new place; focus returns to its menu button so keyboard users keep their place.
  useEffect(() => {
    const pending = afterMove.current;
    if (pending === undefined) return;
    const row = document.querySelector(`[data-account-id="${pending.account}"]`);
    const button = row?.querySelector('button');
    if (button instanceof HTMLElement) {
      button.focus();
      afterMove.current = undefined;
    }
  });

  const fail = (code: string) => setMessage(ledger.explain(code));

  async function archive(account: AccountRow, archived: boolean) {
    setMessage(undefined);
    const r = await ledger.run('ledger.archiveAccount', { id: account.id, archived });
    if (!r.ok) fail(r.error.code);
    else if (archived) status.notify('status.accountArchived');
  }

  /** Swaps an account with its neighbour in the section it is shown in; the saved order is the one list both views share. */
  async function move(section: readonly AccountRow[], index: number, delta: -1 | 1) {
    const moves = moveWithin(basics?.accounts ?? [], section, index, delta);
    if (moves === undefined) return;
    for (const [id, sortOrder] of moves) await ledger.run('ledger.updateAccount', { id, changes: { sortOrder } });
  }

  async function moveToGroup(account: AccountRow, group: AccountGroup | undefined) {
    setMessage(undefined);
    const r = await ledger.run('ledger.moveAccountToGroup', { account: account.id, group: group?.id ?? null });
    if (!r.ok) return fail(r.error.code);
    afterMove.current = { account: account.id };
    if (group === undefined) status.notify('status.accountUngrouped');
    else status.notify('status.accountMoved', { name: group.name });
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
  const rows = (section: AccountSection) => (
    <ul className="mt-2 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10" aria-label={sectionName(section)}>
      {section.accounts.map((a, index) => (
        <AccountItem
          key={a.id} a={a} index={index} count={section.accounts.length} showGroup={view === 'type'} groups={groups} locale={locale}
          onAdd={() => openAdd({ accountId: a.id })} onAdjust={() => setAdjusting(a)} onEdit={() => setEditing(a)}
          onMove={(direction) => void move(section.accounts, index, direction)} onMoveToGroup={(group) => void moveToGroup(a, group)}
          onToggleArchived={() => void archive(a, !a.archived)} onRemove={() => void askDelete(a)}
        />
      ))}
    </ul>
  );
  const sectionName = (section: AccountSection) =>
    section.kind === 'type' ? t(`ledger.kind.${section.accountKind}`) : section.kind === 'group' ? section.group!.name : t('ledger.groups.ungrouped');

  return (
    <LedgerFrame
      titleKey="page.accounts.title"
      actions={<div className="flex flex-wrap items-center gap-3"><Button outline onClick={() => setGroupForm('new')}>{t('ledger.groups.add')}</Button><Button onClick={() => setCreating(true)}>{t('ledger.accounts.add')}</Button></div>}
    >
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">{t('ledger.accounts.lede')}</p>
      {groups.length === 0 ? <p className="mt-2 text-zinc-600 dark:text-zinc-400">{t('ledger.groups.lede')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-(--danger)">{message}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        {groups.length > 0 ? <AccountsViewSwitch value={view} /> : null}
        <SwitchField>
          <Label>{t('ledger.accounts.showArchived')}</Label>
          <Switch checked={showArchived} onChange={(on) => prefsStore.update((p) => ({ ...p, lists: { ...p.lists, showArchivedAccounts: on } }))} />
        </SwitchField>
      </div>

      {none ? (
        <EmptyState className="mt-6" icon={BanknotesIcon} title={t('empty.accounts.title')} body={t('ledger.accounts.empty')} action={<Button onClick={() => setCreating(true)}>{t('empty.accounts.action')}</Button>} />
      ) : null}
      {sections.map((section) =>
        section.kind === 'type' ? (
          <section key={section.key} className="mt-6" aria-labelledby={`kind-${section.accountKind}`}>
            <h2 id={`kind-${section.accountKind}`} className="text-lg font-semibold">{sectionName(section)}</h2>
            {rows(section)}
          </section>
        ) : (
          <GroupSection
            key={section.key} section={section}
            actions={section.group ? (
              <span className="flex flex-wrap gap-2">
                <Button plain onClick={() => setGroupForm(section.group)} aria-label={`${t('ledger.groups.rename')}: ${section.group.name}`}>{t('ledger.groups.rename')}</Button>
                <Button plain onClick={() => setGroupDelete(section.group)} aria-label={`${t('ledger.groups.delete')}: ${section.group.name}`}>{t('ledger.groups.delete')}</Button>
              </span>
            ) : undefined}
          >
            {rows(section)}
          </GroupSection>
        ),
      )}

      {view === 'type' ? <GroupManager groups={groups} onRename={setGroupForm} onDelete={setGroupDelete} /> : null}

      {groupForm ? <GroupFormDialog key={groupForm === 'new' ? 'new' : groupForm.id} group={groupForm} onClose={() => setGroupForm(undefined)} /> : null}
      {groupDelete ? <GroupDeleteDialog key={groupDelete.id} group={groupDelete} onClose={() => setGroupDelete(undefined)} /> : null}

      {creating ? <AccountSheet
        open title={t('ledger.accounts.add')} submitLabel={t('ledger.accounts.create')} onClose={() => setCreating(false)} creating
        initial={{ name: '', kind: 'checking', currency: ledger.fold?.baseCurrency ?? 'USD', opening: '', openingDate: dateToInput(todayLocal()), limit: '', inNetWorth: true, group: '' }}
        onSubmit={async (values) => {
          const input = toInput(values, ledger.parse, t);
          if (!input.ok) return input.error;
          const r = await ledger.run<{ id: string }>('ledger.createAccount', input.value);
          if (!r.ok) return ledger.explain(r.error.code);
          if (values.group !== '') await ledger.run('ledger.moveAccountToGroup', { account: r.value.id, group: values.group });
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
            inNetWorth: editing.includeInNetWorth, group: groupOf(editing, groups)?.id ?? '',
          }}
          onSubmit={async (values) => {
            const input = toInput(values, ledger.parse, t);
            if (!input.ok) return input.error;
            const { kind, name, currency, openingBalanceMinor, openingDate, includeInNetWorth, creditLimitMinor } = input.value;
            const r = await ledger.run('ledger.updateAccount', { id: editing.id, changes: { kind, name, currency, openingBalanceMinor, openingDate, includeInNetWorth, creditLimitMinor } });
            if (!r.ok) return ledger.explain(r.error.code);
            if ((groupOf(editing, groups)?.id ?? '') !== values.group) {
              const moved = await ledger.run('ledger.moveAccountToGroup', { account: editing.id, group: values.group === '' ? null : values.group });
              if (!moved.ok) return ledger.explain(moved.error.code);
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

interface AccountItemProps {
  a: AccountRow; index: number; count: number; showGroup: boolean; groups: readonly AccountGroup[]; locale: string;
  onAdd: () => void; onAdjust: () => void; onEdit: () => void; onMove: (direction: -1 | 1) => void; onMoveToGroup: (group: AccountGroup | undefined) => void;
  onToggleArchived: () => void; onRemove: () => void;
}

function AccountItem({ a, index, count, showGroup, groups, locale, onAdd, onAdjust, onEdit, onMove, onMoveToGroup, onToggleArchived, onRemove }: AccountItemProps) {
  const { t } = useI18n();
  const { on: privacy } = usePrivacy();
  const current = groupOf(a, groups);
  const actions = accountActions({
    archived: a.archived, index, count,
    labels: {
      add: t('ledger.tx.add'), adjust: t('ledger.accounts.adjust'), edit: t('ledger.edit'), moveUp: t('ledger.accounts.moveUp', { name: a.name }), moveDown: t('ledger.accounts.moveDown', { name: a.name }),
      moveToGroup: (name) => t('ledger.accounts.moveToGroup', { name }), moveToUngrouped: t('ledger.accounts.moveToUngrouped'),
      currentGroup: (name) => t('ledger.accounts.currentGroup', { name }), currentUngrouped: t('ledger.accounts.currentUngrouped'),
      archive: t('ledger.accounts.archive'), unarchive: t('ledger.accounts.unarchive'), remove: t('ledger.delete'),
    },
    add: onAdd, adjust: onAdjust, edit: onEdit, move: onMove, toggleArchived: onToggleArchived, remove: onRemove,
    groups: groups.map((g) => ({ id: g.id, name: g.name })), currentGroup: current?.id,
    moveToGroup: (id) => onMoveToGroup(id === null ? undefined : groups.find((g) => g.id === id)),
  });
  // The desktop pop-up takes at most 12 short, plain items, so it leaves out the one-per-group moves; the actions button has them all.
  const onContextMenu = useRowContextMenu(actions.filter((x) => !x.id.startsWith('move-to:')));
  return (
    <li className="flex flex-wrap items-center gap-3 p-3" data-testid="account-row" data-account-id={a.id} onContextMenu={onContextMenu}>
      <Avatar initials={a.name.slice(0, 1).toUpperCase()} className="size-9 shrink-0 bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white" square />
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-center gap-x-2">
          <Link className="truncate font-semibold underline-offset-4 hover:underline" href={`/transactions/?account=${a.id}`}>{a.name}</Link>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{a.currency}</span>
          {a.archived ? <Badge>{t('ledger.accounts.archived')}</Badge> : null}
          {a.includeInNetWorth ? null : <Badge>{t('ledger.accounts.excluded')}</Badge>}
          {showGroup && current ? <Badge data-testid="account-group">{t('ledger.accounts.groupLabel', { name: current.name })}</Badge> : null}
        </div>
      </div>
      <div className="text-lg" {...(privacy ? {} : { 'data-sign': a.balanceMinor === null ? 'zero' : a.balanceMinor > 0n ? 'gain' : a.balanceMinor < 0n ? 'loss' : 'zero' })} data-testid="account-balance">
        {a.balanceMinor === null ? t('ledger.accounts.balanceUnavailable') : <Amount minor={a.balanceMinor} currency={a.currency} locale={locale} />}
      </div>
      <RowActionsMenu label={`${t('ledger.list.actions')} ${a.name}`} actions={actions} />
    </li>
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
        <SelectField label={t('ledger.accounts.form.kind')} value={v.kind} onChange={(v) => set('kind', v as AccountKind)}>
          {ACCOUNT_KINDS.map((k) => <SelectOption key={k} value={k}>{t(`ledger.kind.${k}`)}</SelectOption>)}
        </SelectField>
        <SelectField label={t('ledger.accounts.form.currency')} value={v.currency} onChange={(v) => set('currency', v)} disabled={!creating}>
          {CURRENCIES.map((c) => <SelectOption key={c} value={c}>{c}</SelectOption>)}
        </SelectField>
        <AmountInput label={t('ledger.accounts.form.opening')} currency={v.currency} value={v.opening} onChange={(x) => set('opening', x)} />
        <Disclosure title={t('ledger.accounts.moreOptions')} defaultOpen={!creating}>
          <div className="space-y-4">
            <InputField label={t('ledger.accounts.form.openingDate')} type="date" value={v.openingDate} onChange={(e) => set('openingDate', e.target.value)} required />
            {HAS_LIMIT.has(v.kind) ? <AmountInput label={t('ledger.accounts.form.limit')} currency={v.currency} value={v.limit} onChange={(x) => set('limit', x)} /> : null}
            {ledger.basics && ledger.basics.groups.length > 0 ? (
              <SelectField label={t('ledger.accounts.form.group')} value={v.group} onChange={(v) => set('group', v)}>
                <SelectOption value="">{t('ledger.accounts.ungrouped')}</SelectOption>
                {ledger.basics.groups.map((g) => <SelectOption key={g.id} value={g.id}>{g.name}</SelectOption>)}
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
