'use client';

import type { NeedsAttentionItem, RecentlyDeleted, SearchFilter, TransactionRow, TxnStatus, LocalDate } from '@cashfold/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../forms/Modal';
import { TextField, buttonClass, secondaryButtonClass } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { dateToInput, formatDate, inputToDate } from './dates';
import { signOf } from './format';
import { LedgerFrame } from './LedgerFrame';
import { useLedger } from './LedgerProvider';
import { TransactionForm } from './TransactionForm';

const PAGE = 100;

interface Filters {
  account: string;
  category: string;
  text: string;
  status: '' | TxnStatus;
  from: string;
  to: string;
  min: string;
  max: string;
}
const NO_FILTERS: Filters = { account: '', category: '', text: '', status: '', from: '', to: '', min: '', max: '' };

/** Waits for the Fold's lists, then shows the screen: the body below can rely on them being there. */
export function TransactionsScreen() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.transactions.title">{null}</LedgerFrame>;
  return <TransactionsBody />;
}

function TransactionsBody() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [rows, setRows] = useState<{ items: TransactionRow[]; count: number }>({ items: [], count: 0 });
  const [attention, setAttention] = useState<NeedsAttentionItem[]>([]);
  const [deleted, setDeleted] = useState<RecentlyDeleted[]>([]);
  const [editing, setEditing] = useState<{ row?: TransactionRow } | undefined>();
  const [removing, setRemoving] = useState<TransactionRow | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  // The account in the address (from the Accounts screen) is the starting filter.
  useEffect(() => {
    const account = new URLSearchParams(window.location.search).get('account');
    if (account !== null) {
      setFilters((f) => ({ ...f, account }));
      setApplied((f) => ({ ...f, account }));
    }
  }, []);

  // Typing in the search box applies after a short pause; the other filters apply at once.
  useEffect(() => {
    const id = setTimeout(() => {
      setApplied(filters);
      setLimit(PAGE);
    }, 200);
    return () => clearTimeout(id);
  }, [filters]);

  const accountsById = useMemo(() => new Map(basics.accounts.map((a) => [a.id, a])), [basics.accounts]);
  const categoriesById = useMemo(() => new Map(basics.categories.map((c) => [c.id, c])), [basics.categories]);
  const payeesById = useMemo(() => new Map(basics.payees.map((p) => [p.id, p])), [basics.payees]);
  const selectedAccount = accountsById.get(applied.account as never);

  const filter = useMemo<SearchFilter | { error: string }>(() => {
    const f: { -readonly [K in keyof SearchFilter]: SearchFilter[K] } = {};
    if (applied.account !== '') f.accountIds = [applied.account as never];
    if (applied.category !== '') f.categoryIds = [applied.category as never];
    if (applied.text.trim() !== '') f.text = applied.text;
    if (applied.status !== '') f.statuses = [applied.status];
    const from = inputToDate(applied.from);
    const to = inputToDate(applied.to);
    if (from !== undefined) f.from = from;
    if (to !== undefined) f.to = to;
    if ((applied.min !== '' || applied.max !== '') && selectedAccount !== undefined) {
      const min = applied.min === '' ? undefined : ledger.parse(applied.min, selectedAccount.currency);
      const max = applied.max === '' ? undefined : ledger.parse(applied.max, selectedAccount.currency);
      if ((min && !min.ok) || (max && !max.ok)) return { error: 'amount' };
      f.amount = { currency: selectedAccount.currency, ...(min?.ok && { min: min.value < 0n ? -min.value : min.value }), ...(max?.ok && { max: max.value < 0n ? -max.value : max.value }) };
    }
    return f;
  }, [applied, selectedAccount, ledger]);

  const load = useCallback(async () => {
    if ('error' in filter) return;
    try {
      const [list, needs, gone] = await Promise.all([
        ledger.read<{ items: TransactionRow[]; count: number }>('ledger.transactions', { filter, sort: 'date_desc', page: { limit, offset: 0 } }),
        ledger.read<NeedsAttentionItem[]>('ledger.needsAttention'),
        ledger.read<RecentlyDeleted[]>('ledger.recentlyDeleted'),
      ]);
      setRows(list);
      setAttention(needs);
      setDeleted(gone);
    } catch {
      setMessage(t('ledger.error.load'));
    }
    // `ledger.version` changes after every command, which is when the lists must be asked for again.
  }, [filter, limit, ledger.version, t]);
  useEffect(() => void load(), [load]);

  const groups = useMemo(() => {
    const out: Array<{ date: LocalDate; items: TransactionRow[] }> = [];
    for (const row of rows.items) {
      const last = out.at(-1);
      if (last?.date === row.localDate) last.items.push(row);
      else out.push({ date: row.localDate, items: [row] });
    }
    return out;
  }, [rows.items]);

  async function confirmRemove() {
    if (!removing) return;
    const r = await ledger.run('ledger.deleteTransaction', { id: removing.id });
    if (r.ok) setRemoving(undefined);
    else setMessage(ledger.explain(r.error.code));
  }

  async function restore(id: string) {
    setMessage(undefined);
    const r = await ledger.run('ledger.restoreTransaction', { id });
    if (!r.ok) setMessage(ledger.explain(r.error.code));
  }

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = JSON.stringify(applied) !== JSON.stringify(NO_FILTERS);
  const select = 'mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2';

  return (
    <LedgerFrame titleKey="page.transactions.title" actions={<button type="button" className={buttonClass} onClick={() => setEditing({})} disabled={basics.accounts.length === 0}>{t('ledger.tx.add')}</button>}>
      {basics.accounts.length === 0 ? <p className="mt-4 text-muted">{t('ledger.tx.noAccounts')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}

      {attention.length > 0 ? (
        <section className="mt-4 rounded-ui border border-border-strong p-3" aria-labelledby="attention-title">
          <h2 id="attention-title" className="font-semibold"><span aria-hidden="true">! </span>{t('ledger.attention.title', { count: attention.length })}</h2>
          <p className="mt-1 text-sm text-muted">{t('ledger.attention.lede')}</p>
          <ul className="mt-2 list-disc ps-6" data-testid="attention">
            {attention.map((item, i) => <li key={`${item.kind}-${item.ref ?? i}`}>{t(item.messageKey) === item.messageKey ? t('attention.generic') : t(item.messageKey)}</li>)}
          </ul>
        </section>
      ) : null}

      <form className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2" role="search" aria-label={t('ledger.filter.label')} onSubmit={(e) => e.preventDefault()}>
        <TextField label={t('ledger.filter.text')} type="search" value={filters.text} onChange={(e) => set('text', e.target.value)} />
        <div className="mt-4">
          <label htmlFor="f-account" className="block font-medium">{t('ledger.filter.account')}</label>
          <select id="f-account" className={select} value={filters.account} onChange={(e) => set('account', e.target.value)}>
            <option value="">{t('ledger.filter.any')}</option>
            {basics.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="mt-4">
          <label htmlFor="f-category" className="block font-medium">{t('ledger.filter.category')}</label>
          <select id="f-category" className={select} value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">{t('ledger.filter.any')}</option>
            {basics.categories.map((c) => <option key={c.id} value={c.id}>{c.parentId === null ? c.name : `${categoriesById.get(c.parentId)?.name ?? ''} › ${c.name}`}</option>)}
          </select>
        </div>
        <div className="mt-4">
          <label htmlFor="f-status" className="block font-medium">{t('ledger.filter.status')}</label>
          <select id="f-status" className={select} value={filters.status} onChange={(e) => set('status', e.target.value as Filters['status'])}>
            <option value="">{t('ledger.filter.any')}</option>
            {(['pending', 'posted', 'void'] as const).map((s) => <option key={s} value={s}>{t(`ledger.status.${s}`)}</option>)}
          </select>
        </div>
        <TextField label={t('ledger.filter.from')} type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        <TextField label={t('ledger.filter.to')} type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        <TextField label={t('ledger.filter.min')} value={filters.min} onChange={(e) => set('min', e.target.value)} inputMode="decimal" disabled={selectedAccount === undefined} hint={selectedAccount === undefined ? t('ledger.filter.amountNeedsAccount') : selectedAccount.currency} />
        <TextField label={t('ledger.filter.max')} value={filters.max} onChange={(e) => set('max', e.target.value)} inputMode="decimal" disabled={selectedAccount === undefined} error={'error' in filter ? t('ledger.filter.amountInvalid') : undefined} />
        <div className="mt-4 self-end">
          <button type="button" className={secondaryButtonClass} onClick={() => { setFilters(NO_FILTERS); setApplied(NO_FILTERS); }} disabled={!filtered && JSON.stringify(filters) === JSON.stringify(NO_FILTERS)}>{t('ledger.filter.clear')}</button>
        </div>
      </form>

      <p className="mt-4 text-sm text-muted" role="status" data-testid="tx-count">{t('ledger.tx.count', { count: rows.count })}</p>
      {rows.count === 0 && basics.accounts.length > 0 ? <p className="mt-2 text-muted">{filtered ? t('ledger.tx.noMatches') : t('ledger.tx.empty')}</p> : null}

      {groups.map((group) => (
        <section key={group.date} className="mt-5" aria-labelledby={`day-${group.date}`}>
          <h2 id={`day-${group.date}`} className="text-base font-semibold text-muted">{formatDate(group.date, locale)}</h2>
          <ul className="mt-1 divide-y divide-border-strong rounded-ui border border-border-strong">
            {group.items.map((row) => {
              const account = accountsById.get(row.accountId);
              const category = row.categoryId === null ? undefined : categoriesById.get(row.categoryId);
              const payee = row.payeeId === null ? undefined : payeesById.get(row.payeeId);
              const sign = signOf(row.amountMinor);
              const title = payee?.name ?? (row.note !== '' ? row.note : row.direction === 'adjustment' ? t('ledger.kind.adjustment') : category?.name ?? t('ledger.tx.untitled'));
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="tx-row">
                  <div>
                    <div className="font-medium">
                      {title}
                      {row.isPinned ? <span className="ms-2 text-sm text-muted">{t('ledger.tx.pinned')}</span> : null}
                      {row.isRefund ? <span className="ms-2 text-sm text-muted">{t('ledger.tx.refundBadge')}</span> : null}
                      {row.status === 'posted' ? null : <span className="ms-2 rounded-ui border border-border-strong px-2 text-sm">{t(`ledger.status.${row.status}`)}</span>}
                    </div>
                    <div className="text-sm text-muted">{[account?.name, category?.name, row.place?.name, payee && row.note !== '' ? row.note : undefined].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={sign === 'gain' ? 'text-success' : ''} data-sign={sign} data-testid="tx-amount">{ledger.signed(row.amountMinor, row.currency)}</span>
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditing({ row })} aria-label={`${t('ledger.edit')} ${title}`}>{t('ledger.edit')}</button>
                    <button type="button" className={secondaryButtonClass} onClick={() => setRemoving(row)} aria-label={`${t('ledger.delete')} ${title}`}>{t('ledger.delete')}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {rows.count > rows.items.length ? (
        <button type="button" className={`${secondaryButtonClass} mt-4`} onClick={() => setLimit((n) => n + PAGE)}>{t('ledger.tx.more', { shown: rows.items.length, count: rows.count })}</button>
      ) : null}

      <section className="mt-10" aria-labelledby="deleted-title">
        <h2 id="deleted-title" className="text-lg font-semibold">{t('ledger.deleted.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('ledger.deleted.lede')}</p>
        {deleted.length === 0 ? <p className="mt-2 text-muted">{t('ledger.deleted.empty')}</p> : null}
        <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" data-testid="deleted-list">
          {deleted.map((d) => (
            <li key={d.transaction.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <span className="font-medium">{d.transaction.note !== '' ? d.transaction.note : (d.transaction.payeeId === null ? undefined : payeesById.get(d.transaction.payeeId))?.name ?? accountsById.get(d.transaction.accountId)?.name}</span>
                <span className="ms-3 text-sm text-muted">{formatDate(d.transaction.localDate, locale)} · {ledger.signed(d.transaction.amountMinor, d.transaction.currency)} · {t('ledger.deleted.daysLeft', { days: d.daysLeft })}</span>
              </div>
              <button type="button" className={secondaryButtonClass} onClick={() => void restore(d.transaction.id)} aria-label={`${t('ledger.deleted.restore')} ${formatDate(d.transaction.localDate, locale)}`}>{t('ledger.deleted.restore')}</button>
            </li>
          ))}
        </ul>
      </section>

      <Modal open={editing !== undefined} title={editing?.row ? t('ledger.tx.edit') : t('ledger.tx.add')} onClose={() => setEditing(undefined)}>
        {editing ? <TransactionForm key={editing.row?.id ?? 'new'} {...(editing.row && { existing: editing.row })} {...(filters.account !== '' && { defaultAccountId: filters.account })} onDone={() => setEditing(undefined)} /> : null}
      </Modal>

      <Modal open={removing !== undefined} title={t('ledger.tx.delete.title')} onClose={() => setRemoving(undefined)}>
        {removing ? (
          <div>
            <p className="mt-3">{t('ledger.tx.delete.consequence', { when: dateToInput(removing.localDate) })}</p>
            <div className="mt-6 flex gap-3">
              <button type="button" className={buttonClass} onClick={() => void confirmRemove()}>{t('ledger.tx.delete.confirm')}</button>
              <button type="button" className={secondaryButtonClass} onClick={() => setRemoving(undefined)}>{t('ledger.cancel')}</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}
