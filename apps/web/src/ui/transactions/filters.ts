// The filters of the transaction list and their mirror in the address (contracts/routes.md §4). Pure: the screen reads and writes the URL.
import { isIsoDate } from '../prefs/schema';

export type StatusFilter = '' | 'pending' | 'posted' | 'void';
export interface Filters {
  account: string;
  category: string;
  status: StatusFilter;
  from: string;
  to: string;
  min: string;
  max: string;
  text: string;
}
export const NO_FILTERS: Filters = { account: '', category: '', status: '', from: '', to: '', min: '', max: '', text: '' };

const PARAMS: ReadonlyArray<readonly [keyof Filters, string]> = [
  ['account', 'account'], ['category', 'category'], ['status', 'status'], ['from', 'from'], ['to', 'to'], ['min', 'min'], ['max', 'max'], ['text', 'q'],
];

export function filtersFromQuery(params: URLSearchParams): Filters {
  const out: Filters = { ...NO_FILTERS };
  const status = params.get('status');
  if (status === 'pending' || status === 'posted' || status === 'void') out.status = status;
  for (const key of ['from', 'to'] as const) {
    const v = params.get(key);
    if (v !== null && isIsoDate(v)) out[key] = v;
  }
  for (const [key, name] of PARAMS) {
    if (key === 'status' || key === 'from' || key === 'to') continue;
    const v = params.get(name);
    if (v !== null && v !== '') out[key] = v;
  }
  return out;
}

/** The query with the filters written into it; other parameters (such as `new`) are kept, and a cleared filter leaves nothing behind. */
export function filtersToQuery(filters: Filters, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const [key, name] of PARAMS) {
    next.delete(name);
    if (filters[key] !== '') next.set(name, filters[key]);
  }
  return next;
}

export type ChipId = 'account' | 'category' | 'status' | 'range' | 'amount' | 'text';
export interface Chip {
  id: ChipId;
  label: string;
}
export interface ChipLabels {
  account(id: string): string;
  category(id: string): string;
  status(status: string): string;
  range(from: string, to: string): string;
  amount(min: string, max: string): string;
  text(text: string): string;
}

export function appliedChips(f: Filters, labels: ChipLabels): Chip[] {
  const chips: Chip[] = [];
  if (f.account) chips.push({ id: 'account', label: labels.account(f.account) });
  if (f.category) chips.push({ id: 'category', label: labels.category(f.category) });
  if (f.status) chips.push({ id: 'status', label: labels.status(f.status) });
  if (f.from || f.to) chips.push({ id: 'range', label: labels.range(f.from, f.to) });
  if (f.min || f.max) chips.push({ id: 'amount', label: labels.amount(f.min, f.max) });
  if (f.text.trim()) chips.push({ id: 'text', label: labels.text(f.text.trim()) });
  return chips;
}

export function removeFilter(f: Filters, id: ChipId): Filters {
  switch (id) {
    case 'range': return { ...f, from: '', to: '' };
    case 'amount': return { ...f, min: '', max: '' };
    case 'text': return { ...f, text: '' };
    default: return { ...f, [id]: '' };
  }
}
