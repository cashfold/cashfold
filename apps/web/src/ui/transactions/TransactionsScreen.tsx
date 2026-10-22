'use client';

import type { LocalDate, NeedsAttentionItem, RecentlyDeleted, RecentlyDeletedTransfer, SearchFilter, TransactionRow, TransferRow } from '@cashfold/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InputField, SelectField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import {
  Amount, Badge, Button, RowButton, Chip, ConfirmDialog, Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu, ArrowsRightLeftIcon, EllipsisHorizontalIcon, EmptyState, FunnelIcon, Input,
  InputGroup, MagnifyingGlassIcon, Notice, Sheet,
} from '../kit';
import { dateToInput, formatDate, inputToDate } from '../ledger/dates';
import { LedgerFrame } from '../ledger/LedgerFrame';
import { useLedger } from '../ledger/LedgerProvider';
import { useAddSheet } from '../shell/add-context';
import { useStatus } from '../shell/StatusProvider';
import { AddSheet } from './AddSheet';
import { ScheduleInboxBanner } from './ScheduleInboxBanner';
import { groupByDay, type DayGroup as DayGroupData, type DayRow } from './day-groups';
import { useWindowedBlock } from './useWindowedRows';
import { NO_FILTERS, appliedChips, filtersFromQuery, filtersToQuery, removeFilter, type Filters, type StatusFilter } from './filters';

const PAGE = 100;
/** Day groups below the first screenful are rendered only while they are near the viewport (FR-027); these size the ones not yet seen. */
const EAGER_GROUPS = 6;
const ROW_ESTIMATE_PX = 64;
const HEADING_ESTIMATE_PX = 52;

/** Waits for the Fold's lists, then shows the screen: the body below can rely on them being there. */
export function TransactionsScreen() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.transactions.title">{null}</LedgerFrame>;
  return <TransactionsBody />;
}

function TransactionsBody() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const status = useStatus();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openAdd } = useAddSheet();
  const basics = ledger.basics!;
  const filters = useMemo(() => filtersFromQuery(new URLSearchParams(params.toString())), [params]);
  const [text, setText] = useState(filters.text);
  // How many rows a full read asks for: one page, or as many as are loaded when the list is read again after a change.
  const wanted = useRef(PAGE);
  const [rows, setRows] = useState<{ items: TransactionRow[]; count: number }>({ items: [], count: 0 });
  const [attention, setAttention] = useState<NeedsAttentionItem[]>([]);
  const [attentionShown, setAttentionShown] = useState(true);
  const [deleted, setDeleted] = useState<RecentlyDeleted[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [deletedTransfers, setDeletedTransfers] = useState<RecentlyDeletedTransfer[]>([]);
  const [editingTransfer, setEditingTransfer] = useState<TransferRow | undefined>();
  const [removingTransfer, setRemovingTransfer] = useState<TransferRow | undefined>();
  const [editing, setEditing] = useState<TransactionRow | undefined>();
  const [removing, setRemoving] = useState<TransactionRow | undefined>();
  const [panel, setPanel] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const apply = useCallback(
    (next: Filters) => {
      const query = filtersToQuery(next, new URLSearchParams(window.location.search)).toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`);
      wanted.current = PAGE;
    },
    [router, pathname],
  );

  // Typing in the search box applies after a short pause (200 ms); the other filters apply at once.
  useEffect(() => {
    if (text === filters.text) return;
    const id = setTimeout(() => apply({ ...filters, text }), 200);
    return () => clearTimeout(id);
  }, [text, filters, apply]);
  useEffect(() => setText(filters.text), [filters.text]);

  const accountsById = useMemo(() => new Map(basics.accounts.map((a) => [a.id, a])), [basics.accounts]);
  const categoriesById = useMemo(() => new Map(basics.categories.map((c) => [c.id, c])), [basics.categories]);
  const payeesById = useMemo(() => new Map(basics.payees.map((p) => [p.id, p])), [basics.payees]);
  const selectedAccount = accountsById.get(filters.account as never);

  const filter = useMemo<SearchFilter | { error: string }>(() => {
    const f: { -readonly [K in keyof SearchFilter]: SearchFilter[K] } = {};
    if (filters.account !== '') f.accountIds = [filters.account as never];
    if (filters.category !== '') f.categoryIds = [filters.category as never];
    if (filters.text.trim() !== '') f.text = filters.text;
    if (filters.status !== '') f.statuses = [filters.status];
    const from = inputToDate(filters.from);
    const to = inputToDate(filters.to);
    if (from !== undefined) f.from = from;
    if (to !== undefined) f.to = to;
    if ((filters.min !== '' || filters.max !== '') && selectedAccount !== undefined) {
      const min = filters.min === '' ? undefined : ledger.parse(filters.min, selectedAccount.currency);
      const max = filters.max === '' ? undefined : ledger.parse(filters.max, selectedAccount.currency);
      if ((min && !min.ok) || (max && !max.ok)) return { error: 'amount' };
      f.amount = { currency: selectedAccount.currency, ...(min?.ok && { min: min.value < 0n ? -min.value : min.value }), ...(max?.ok && { max: max.value < 0n ? -max.value : max.value }) };
    }
    return f;
  }, [filters, selectedAccount, ledger]);

  const load = useCallback(async () => {
    if ('error' in filter) return;
    try {
      const [list, needs, gone, moves, goneMoves] = await Promise.all([
        ledger.read<{ items: TransactionRow[]; count: number }>('ledger.transactions', { filter, sort: 'date_desc', page: { limit: wanted.current, offset: 0 } }),
        ledger.read<NeedsAttentionItem[]>('ledger.needsAttention'),
        ledger.read<RecentlyDeleted[]>('ledger.recentlyDeleted'),
        ledger.read<TransferRow[]>('ledger.transfers'),
        ledger.read<RecentlyDeletedTransfer[]>('ledger.recentlyDeletedTransfers'),
      ]);
      setTransfers(moves);
      setDeletedTransfers(goneMoves);
      setRows(list);
      setAttention(needs);
      setDeleted(gone);
    } catch {
      setMessage(t('ledger.error.load'));
    }
    // `ledger.version` changes after every command, which is when the lists must be asked for again.
  }, [filter, ledger.version, t]);

  // "Show more" reads only the next page and adds it, so paging through a long list does not read it all again each time.
  async function showMore() {
    if ('error' in filter) return;
    try {
      const next = await ledger.read<{ items: TransactionRow[]; count: number }>('ledger.transactions', { filter, sort: 'date_desc', page: { limit: PAGE, offset: rows.items.length } });
      wanted.current = rows.items.length + next.items.length;
      setRows((r) => ({ items: [...r.items, ...next.items], count: next.count }));
    } catch {
      setMessage(t('ledger.error.load'));
    }
  }
  useEffect(() => void load(), [load]);

  // Transfers sit in the same list as the transactions. They follow the filters that make sense for them, and while the list is still being paged
  // in they stop at the oldest loaded transaction, so the groups are complete.
  const visibleTransfers = useMemo(() => {
    if (filters.category !== '' || filters.min !== '' || filters.max !== '') return [];
    const from = inputToDate(filters.from);
    const to = inputToDate(filters.to);
    const oldest = rows.count > rows.items.length ? rows.items.at(-1)?.localDate : undefined;
    const needle = filters.text.trim().toLowerCase();
    return transfers.filter(
      (x) =>
        (filters.account === '' || x.fromAccountId === filters.account || x.toAccountId === filters.account) &&
        (filters.status === '' || x.status === filters.status) &&
        (from === undefined || x.localDate >= from) && (to === undefined || x.localDate <= to) &&
        (oldest === undefined || x.localDate >= oldest) &&
        (needle === '' || x.note.toLowerCase().includes(needle)),
    );
  }, [transfers, filters, rows]);

  type Entry = { id: string; localDate: number; amountMinor: bigint; occurredUtcMs: number; tx?: TransactionRow; xf?: TransferRow };
  const groups = useMemo(() => {
    const entries: Entry[] = [
      ...rows.items.map((tx) => ({ id: tx.id, localDate: tx.localDate as number, amountMinor: tx.amountMinor, occurredUtcMs: tx.occurredUtcMs, tx })),
      ...visibleTransfers.map((xf) => ({ id: xf.id, localDate: xf.localDate as number, amountMinor: 0n, occurredUtcMs: xf.occurredUtcMs, xf })),
    ];
    // The transactions arrive newest first already; only merging transfers in needs the order made again.
    if (visibleTransfers.length > 0) entries.sort((a, b) => b.localDate - a.localDate || b.occurredUtcMs - a.occurredUtcMs);
    // More transactions exist than are loaded: the last day may be incomplete.
    return groupByDay(entries, entries.length + (rows.count - rows.items.length));
  }, [rows, visibleTransfers]);

  // The currency a day's net is shown in: that of its first transaction (looked up once, not per group).
  const currencyByDate = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rows.items) if (!map.has(r.localDate)) map.set(r.localDate, r.currency);
    return map;
  }, [rows]);

  async function confirmRemove() {
    if (!removing) return;
    const r = await ledger.run('ledger.deleteTransaction', { id: removing.id });
    if (r.ok) {
      setRemoving(undefined);
      status.notify('status.deleted');
    } else setMessage(ledger.explain(r.error.code));
  }
  async function restore(id: string) {
    setMessage(undefined);
    const r = await ledger.run('ledger.restoreTransaction', { id });
    if (r.ok) status.notify('status.restored');
    else setMessage(ledger.explain(r.error.code));
  }
  async function confirmRemoveTransfer() {
    if (!removingTransfer) return;
    const r = await ledger.run('ledger.deleteTransfer', { id: removingTransfer.id });
    if (r.ok) {
      setRemovingTransfer(undefined);
      status.notify('status.deleted');
    } else setMessage(ledger.explain(r.error.code));
  }
  async function restoreTransfer(id: string) {
    setMessage(undefined);
    const r = await ledger.run('ledger.restoreTransfer', { id });
    if (r.ok) status.notify('status.restored');
    else setMessage(ledger.explain(r.error.code));
  }
  const transferTitle = (x: Pick<TransferRow, 'fromAccountId' | 'toAccountId'>) => `${accountsById.get(x.fromAccountId)?.name ?? '?'} → ${accountsById.get(x.toAccountId)?.name ?? '?'}`;

  async function togglePin(row: TransactionRow) {
    const r = await ledger.run('ledger.updateTransaction', { id: row.id, changes: { isPinned: !row.isPinned } });
    if (!r.ok) setMessage(ledger.explain(r.error.code));
  }

  const showDate = (iso: string): string => {
    const d = inputToDate(iso);
    return d === undefined ? '…' : formatDate(d, locale);
  };
  const chips = appliedChips(filters, {
    account: (id) => accountsById.get(id as never)?.name ?? id,
    category: (id) => categoriesById.get(id as never)?.name ?? id,
    status: (s) => t(`ledger.status.${s}`),
    range: (from, to) => `${showDate(from)} – ${showDate(to)}`,
    amount: (min, max) => `${min || '…'} – ${max || '…'}`,
    text: (s) => `“${s}”`,
  });
  const filtered = chips.length > 0;
  const titleOf = (row: TransactionRow) => {
    const category = row.categoryId === null ? undefined : categoriesById.get(row.categoryId);
    const payee = row.payeeId === null ? undefined : payeesById.get(row.payeeId);
    return payee?.name ?? (row.note !== '' ? row.note : row.direction === 'adjustment' ? t('ledger.kind.adjustment') : category?.name ?? t('ledger.tx.untitled'));
  };

  return (
    <LedgerFrame
      titleKey="page.transactions.title"
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown>
            <DropdownButton plain aria-label={t('ledger.list.more')}><EllipsisHorizontalIcon data-slot="icon" aria-hidden="true" /></DropdownButton>
            <DropdownMenu anchor="bottom end">
              <DropdownItem onClick={() => setShowDeleted((v) => !v)}><DropdownLabel>{showDeleted ? t('ledger.list.back') : t('ledger.deleted.title')}</DropdownLabel></DropdownItem>
            </DropdownMenu>
          </Dropdown>
          <Button onClick={() => openAdd(filters.account !== '' ? { accountId: filters.account } : {})} disabled={basics.accounts.length === 0}>{t('ledger.tx.add')}</Button>
        </div>
      )}
    >
      {basics.accounts.length === 0 ? <p className="mt-4 text-zinc-600 dark:text-zinc-400">{t('ledger.tx.noAccounts')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-(--danger)">{message}</p> : null}

      {showDeleted ? (
        <section className="mt-6" aria-labelledby="deleted-title">
          <h2 id="deleted-title" className="text-lg font-semibold">{t('ledger.deleted.title')}</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('ledger.deleted.lede')}</p>
          {deleted.length === 0 && deletedTransfers.length === 0 ? <EmptyState className="mt-3" icon={EllipsisHorizontalIcon} title={t('ledger.deleted.empty')} body={t('ledger.deleted.lede')} /> : null}
          <ul className="mt-3 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 empty:hidden dark:divide-white/10 dark:border-white/10" data-testid="deleted-list">
            {deleted.map((d) => (
              <li key={d.transaction.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <span className="font-medium">{d.transaction.note !== '' ? d.transaction.note : (d.transaction.payeeId === null ? undefined : payeesById.get(d.transaction.payeeId))?.name ?? accountsById.get(d.transaction.accountId)?.name}</span>
                  <span className="ms-3 text-sm text-zinc-600 dark:text-zinc-400">{formatDate(d.transaction.localDate, locale)} · {ledger.signed(d.transaction.amountMinor, d.transaction.currency)} · {t('ledger.deleted.daysLeft', { days: d.daysLeft })}</span>
                </div>
                <Button outline onClick={() => void restore(d.transaction.id)} aria-label={`${t('ledger.deleted.restore')} ${formatDate(d.transaction.localDate, locale)}`}>{t('ledger.deleted.restore')}</Button>
              </li>
            ))}
          </ul>
          <ul className="mt-3 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 empty:hidden dark:divide-white/10 dark:border-white/10" data-testid="xfer-deleted">
            {deletedTransfers.map((d) => (
              <li key={d.transfer.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <span className="font-medium">{transferTitle(d.transfer)}</span>
                  <span className="ms-3 text-sm text-zinc-600 dark:text-zinc-400">{formatDate(d.transfer.localDate, locale)} · {t('ledger.deleted.daysLeft', { days: d.daysLeft })}</span>
                </div>
                <Button outline onClick={() => void restoreTransfer(d.transfer.id)} aria-label={`${t('ledger.deleted.restore')} ${transferTitle(d.transfer)}`}>{t('ledger.deleted.restore')}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <ScheduleInboxBanner />
          {attention.length > 0 && attentionShown ? (
            <Notice className="mt-4" tone="warning" title={t('ledger.attention.title', { count: attention.length })} onDismiss={() => setAttentionShown(false)} dismissLabel={t('status.dismiss')}>
              <ul className="list-disc ps-5" data-testid="attention">
                {attention.map((item, i) => <li key={`${item.kind}-${item.ref ?? i}`}>{t(item.messageKey) === item.messageKey ? t('attention.generic') : t(item.messageKey)}</li>)}
              </ul>
            </Notice>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2" role="search" aria-label={t('ledger.filter.label')}>
            <div className="min-w-0 basis-full flex-1 sm:basis-0">
              <InputGroup>
                <MagnifyingGlassIcon data-slot="icon" aria-hidden="true" />
                <Input type="search" name="search" aria-label={t('ledger.filter.text')} placeholder={t('filter.search')} value={text} onChange={(e) => setText(e.target.value)} />
              </InputGroup>
            </div>
            <Button outline onClick={() => setPanel(true)}>
              <FunnelIcon data-slot="icon" aria-hidden="true" />
              {t('filter.label')}{chips.length > 0 ? ` (${chips.length})` : ''}
            </Button>
          </div>
          {chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="filter-chips">
              {chips.map((c) => <Chip key={c.id} label={c.label} removeLabel={t('filter.remove', { name: c.label })} onRemove={() => apply(removeFilter(filters, c.id))} />)}
              <Button plain onClick={() => apply(NO_FILTERS)}>{t('filter.clearAll')}</Button>
            </div>
          ) : null}

          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400" role="status" data-testid="tx-count">{t('ledger.tx.count', { count: rows.count })}</p>
          {rows.count === 0 && visibleTransfers.length === 0 && basics.accounts.length > 0 ? (
            <EmptyState
              className="mt-3" icon={filtered ? FunnelIcon : MagnifyingGlassIcon} title={filtered ? t('ledger.tx.noMatches') : t('ledger.tx.empty')} body={filtered ? t('empty.tx.filtered') : t('empty.tx.body')}
              action={filtered ? <Button outline onClick={() => apply(NO_FILTERS)}>{t('ledger.filter.clear')}</Button> : <Button onClick={() => openAdd()}>{t('empty.tx.action')}</Button>}
            />
          ) : null}

          {groups.map((group, index) => (
            <DayGroup
              key={group.date} group={group} eager={index < EAGER_GROUPS} currency={currencyByDate.get(group.date as number) ?? basics.baseCurrency ?? 'USD'}
              renderEntry={(entry) => entry.tx
                ? <Row key={entry.id} row={entry.tx} title={titleOf(entry.tx)} onEdit={() => setEditing(entry.tx)} onPin={() => void togglePin(entry.tx!)} onDelete={() => setRemoving(entry.tx)} />
                : <TransferItem key={entry.id} x={entry.xf!} title={transferTitle(entry.xf!)} />}
            />
          ))}
          {rows.count > rows.items.length ? (
            <Button outline className="mt-4" onClick={() => void showMore()}>{t('ledger.tx.more', { shown: rows.items.length, count: rows.count })}</Button>
          ) : null}

        </>
      )}

      <FiltersPanel open={panel} onClose={() => setPanel(false)} filters={filters} invalid={'error' in filter} onApply={(f) => { apply(f); setPanel(false); }} />

      {editing ? <AddSheet key={editing.id} existing={editing} onClose={() => setEditing(undefined)} /> : null}
      {editingTransfer ? <AddSheet key={editingTransfer.id} existingTransfer={editingTransfer} onClose={() => setEditingTransfer(undefined)} /> : null}
      <ConfirmDialog
        open={removingTransfer !== undefined} destructive title={t('ledger.xfer.delete.title')} body={removingTransfer ? `${transferTitle(removingTransfer)} — ${t('ledger.xfer.delete.consequence')}` : undefined}
        confirmLabel={t('ledger.xfer.delete.confirm')} cancelLabel={t('ledger.cancel')} onConfirm={() => void confirmRemoveTransfer()} onCancel={() => setRemovingTransfer(undefined)}
      />
      <ConfirmDialog
        open={removing !== undefined} destructive title={t('ledger.tx.delete.title')}
        body={removing ? `${titleOf(removing)} — ${t('ledger.tx.delete.consequence', { when: dateToInput(removing.localDate) })}` : undefined}
        confirmLabel={t('ledger.tx.delete.confirm')} cancelLabel={t('ledger.cancel')} onConfirm={() => void confirmRemove()} onCancel={() => setRemoving(undefined)}
      />
    </LedgerFrame>
  );

  function TransferItem({ x, title }: { x: TransferRow; title: string }) {
    const from = accountsById.get(x.fromAccountId);
    const to = accountsById.get(x.toAccountId);
    return (
      <li className="flex items-center gap-3 p-3" data-testid="xfer-row">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"><ArrowsRightLeftIcon className="size-5" /></span>
        <RowButton onClick={() => setEditingTransfer(x)} className="flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="truncate font-medium">{title}</span>
            <Badge>{t('ledger.list.transfer')}</Badge>
            {x.status === 'posted' ? null : <Badge color={x.status === 'void' ? 'red' : 'amber'}>{t(`ledger.status.${x.status}`)}</Badge>}
          </span>
          <span className="block truncate text-sm text-zinc-600 dark:text-zinc-400">
            <span data-testid="xfer-out">{from ? ledger.signed(-x.fromAmountMinor, from.currency) : ''}</span>
            {' → '}
            <span data-testid="xfer-in">{to ? ledger.signed(x.toAmountMinor, to.currency) : ''}</span>
            {x.note !== '' ? ` · ${x.note}` : ''}
          </span>
        </RowButton>
        <Dropdown>
          <DropdownButton plain aria-label={`${t('ledger.list.actions')} ${title}`}><EllipsisHorizontalIcon data-slot="icon" aria-hidden="true" /></DropdownButton>
          <DropdownMenu anchor="bottom end">
            <DropdownItem onClick={() => setEditingTransfer(x)}><DropdownLabel>{t('ledger.edit')}</DropdownLabel></DropdownItem>
            <DropdownItem onClick={() => setRemovingTransfer(x)}><DropdownLabel>{t('ledger.delete')}</DropdownLabel></DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </li>
    );
  }

  function Row({ row, title, onEdit, onPin, onDelete }: { row: TransactionRow; title: string; onEdit: () => void; onPin: () => void; onDelete: () => void }) {
    const account = accountsById.get(row.accountId);
    const category = row.categoryId === null ? undefined : categoriesById.get(row.categoryId);
    const payee = row.payeeId === null ? undefined : payeesById.get(row.payeeId);
    const colour = category?.color === undefined ? undefined : ['#0b57d0', '#146c2e', '#b3261e', '#8a5100', '#6f42c1', '#006a6a', '#a8326d', '#5a6b00', '#7a4a2a', '#2b6cb0', '#4a4f57', '#b45309'][category.color % 12];
    return (
      <li className="flex items-center gap-3 p-3" data-testid="tx-row">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-600 text-sm font-semibold text-white" {...(colour ? { style: { backgroundColor: colour } } : {})}>
          {(category?.name ?? title).slice(0, 1).toUpperCase()}
        </span>
        <RowButton onClick={onEdit} className="flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="truncate font-medium">{title}</span>
            {row.isPinned ? <Badge>{t('ledger.tx.pinned')}</Badge> : null}
            {row.isRefund ? <Badge>{t('ledger.tx.refundBadge')}</Badge> : null}
            {row.attachment ? <Badge>{t('ledger.attachment.title')}</Badge> : null}
            {row.status === 'posted' ? null : <Badge color={row.status === 'void' ? 'red' : 'amber'}>{t(`ledger.status.${row.status}`)}</Badge>}
          </span>
          <span className="block truncate text-sm text-zinc-600 dark:text-zinc-400">{[category?.name, account?.name, row.place?.name, payee && row.note !== '' ? row.note : undefined].filter(Boolean).join(' · ')}</span>
        </RowButton>
        <span data-testid="tx-amount" data-sign={row.amountMinor > 0n ? 'gain' : row.amountMinor < 0n ? 'loss' : 'zero'}>
          <Amount minor={row.amountMinor} currency={row.currency} locale={locale} tone="auto" showSign />
        </span>
        <Dropdown>
          <DropdownButton plain aria-label={`${t('ledger.list.actions')} ${title}`}><EllipsisHorizontalIcon data-slot="icon" aria-hidden="true" /></DropdownButton>
          <DropdownMenu anchor="bottom end">
            <DropdownItem onClick={onEdit}><DropdownLabel>{t('ledger.edit')}</DropdownLabel></DropdownItem>
            <DropdownItem onClick={onPin}><DropdownLabel>{row.isPinned ? t('ledger.list.unpin') : t('ledger.list.pin')}</DropdownLabel></DropdownItem>
            <DropdownItem onClick={onDelete}><DropdownLabel>{t('ledger.delete')}</DropdownLabel></DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </li>
    );
  }
}

function FiltersPanel({ open, onClose, filters, invalid, onApply }: { open: boolean; onClose: () => void; filters: Filters; invalid: boolean; onApply: (f: Filters) => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (open) setDraft(filters); }, [open, filters]);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setDraft((f) => ({ ...f, [key]: value }));
  const account = basics.accounts.find((a) => a.id === draft.account);
  return (
    <Sheet
      open={open} onClose={onClose} title={t('filter.label')}
      footer={<><Button plain type="button" onClick={() => onApply(NO_FILTERS)}>{t('filter.clearAll')}</Button><Button type="submit" form="filters-form">{t('filter.apply')}</Button></>}
    >
      <form id="filters-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); onApply(draft); }}>
        <SelectField label={t('ledger.filter.account')} value={draft.account} onChange={(e) => setDraft((f) => ({ ...f, account: e.target.value, ...(e.target.value === '' ? { min: '', max: '' } : {}) }))}>
          <option value="">{t('ledger.filter.any')}</option>
          {basics.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </SelectField>
        <SelectField label={t('ledger.filter.category')} value={draft.category} onChange={(e) => set('category', e.target.value)}>
          <option value="">{t('ledger.filter.any')}</option>
          {basics.categories.map((c) => <option key={c.id} value={c.id}>{c.parentId === null ? c.name : `${basics.categories.find((x) => x.id === c.parentId)?.name ?? ''} › ${c.name}`}</option>)}
        </SelectField>
        <SelectField label={t('ledger.filter.status')} value={draft.status} onChange={(e) => set('status', e.target.value as StatusFilter)}>
          <option value="">{t('ledger.filter.any')}</option>
          {(['pending', 'posted', 'void'] as const).map((s) => <option key={s} value={s}>{t(`ledger.status.${s}`)}</option>)}
        </SelectField>
        <div className="grid grid-cols-2 gap-4">
          <InputField label={t('ledger.filter.from')} type="date" value={draft.from} onChange={(e) => set('from', e.target.value)} />
          <InputField label={t('ledger.filter.to')} type="date" value={draft.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InputField label={t('ledger.filter.min')} value={draft.min} onChange={(e) => set('min', e.target.value)} inputMode="decimal" disabled={account === undefined} hint={account === undefined ? t('ledger.filter.amountNeedsAccount') : account.currency} />
          <InputField label={t('ledger.filter.max')} value={draft.max} onChange={(e) => set('max', e.target.value)} inputMode="decimal" disabled={account === undefined} error={invalid ? t('ledger.filter.amountInvalid') : undefined} />
        </div>
      </form>
    </Sheet>
  );
}

/** One day of the list: the heading with the day's net and its entries, rendered only while it is near the viewport (a module-level component, so it keeps its state between renders of the list). */
function DayGroup<E extends DayRow>({ group, eager, currency, renderEntry }: { group: DayGroupData<E>; eager: boolean; currency: string; renderEntry: (entry: E) => ReactNode }) {
  const { t, locale } = useI18n();
  const { ref, rendered } = useWindowedBlock<HTMLElement>(eager, ROW_ESTIMATE_PX * group.items.length + HEADING_ESTIMATE_PX);
  return (
    <section ref={ref} className="mt-5" aria-labelledby={`day-${group.date}`}>
      {rendered ? (
        <>
          <h2 id={`day-${group.date}`} className="sticky top-0 z-10 flex items-baseline justify-between bg-white/90 py-1 text-sm font-semibold text-zinc-600 backdrop-blur dark:bg-zinc-900/90 dark:text-zinc-400">
            <span>{formatDate(group.date as LocalDate, locale)}</span>
            <span className="font-normal">
              {group.partial ? `${t('ledger.list.soFar')} ` : ''}
              <Amount minor={group.netMinor} currency={currency} locale={locale} showSign />
            </span>
          </h2>
          <ul className="divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10">{group.items.map(renderEntry)}</ul>
        </>
      ) : null}
    </section>
  );
}
