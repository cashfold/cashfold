import { formatAmount } from '../../shared-kernel/amount-text';
import { dayOf, monthOf, yearOf, type LocalDate } from '../../shared-kernel/local-date';
import type { Ledger } from './projections/ledger';
import { compareText } from '../domain/util';

// Export of the ledger as CSV (FR-092): one row per transaction and one per transfer, amounts in the account's own currency as
// exact decimal text with a dot and no grouping, so another program reads them back unchanged. Text that a spreadsheet could
// take for a formula is marked so it is shown as text.

export const CSV_COLUMNS = ['date', 'account', 'type', 'amount', 'currency', 'category', 'payee', 'tags', 'note', 'status', 'to_account', 'to_amount', 'to_currency'] as const;

const PLAIN = { decimal: '.', group: '' } as const;

/** A cell: quoted when it needs to be, and prefixed with an apostrophe when it would otherwise start a spreadsheet formula. */
export function csvCell(text: string, numeric = false): string {
  let value = text;
  if (!numeric && /^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const dateText = (d: LocalDate): string => `${String(yearOf(d)).padStart(4, '0')}-${String(monthOf(d)).padStart(2, '0')}-${String(dayOf(d)).padStart(2, '0')}`;

export function exportLedgerCsv(ledger: Ledger): string {
  const accountName = (id: string): string => ledger.accounts.get(id as never)?.name ?? '';
  const categoryName = (id: string | null): string => {
    if (id === null) return '';
    const c = ledger.categories.get(id as never);
    if (c === undefined) return '';
    const parent = c.parentId === null ? undefined : ledger.categories.get(c.parentId);
    return parent === undefined ? c.name : `${parent.name} > ${c.name}`;
  };
  const rows: Array<{ sortDate: number; sortId: string; cells: string[] }> = [];
  for (const t of ledger.transactions.values()) {
    rows.push({
      sortDate: t.localDate, sortId: t.id,
      cells: [
        csvCell(dateText(t.localDate), true), csvCell(accountName(t.accountId)), t.direction, csvCell(formatAmount({ minor: t.amountMinor, currency: t.currency }, PLAIN), true),
        t.currency, csvCell(categoryName(t.categoryId)), csvCell(ledger.payees.get(t.payeeId as never)?.name ?? ''),
        csvCell(t.tagIds.map((id) => ledger.tags.get(id)?.name ?? '').filter(Boolean).sort(compareText).join(';')), csvCell(t.note), t.status, '', '', '',
      ],
    });
  }
  for (const x of ledger.transfers.values()) {
    const from = ledger.accounts.get(x.fromAccountId);
    const to = ledger.accounts.get(x.toAccountId);
    if (from === undefined || to === undefined) continue;
    rows.push({
      sortDate: x.localDate, sortId: x.id,
      cells: [
        csvCell(dateText(x.localDate), true), csvCell(from.name), 'transfer', csvCell(formatAmount({ minor: -x.fromAmountMinor, currency: from.currency }, PLAIN), true), from.currency,
        '', '', '', csvCell(x.note), x.status, csvCell(to.name), csvCell(formatAmount({ minor: x.toAmountMinor, currency: to.currency }, PLAIN), true), to.currency,
      ],
    });
  }
  rows.sort((a, b) => a.sortDate - b.sortDate || compareText(a.sortId, b.sortId));
  return [CSV_COLUMNS.join(','), ...rows.map((r) => r.cells.join(','))].join('\r\n') + '\r\n';
}
