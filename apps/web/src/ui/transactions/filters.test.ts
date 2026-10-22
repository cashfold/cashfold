import { describe, expect, it } from 'vitest';
import { NO_FILTERS, appliedChips, filtersFromQuery, filtersToQuery, removeFilter } from './filters';

const q = (s: string) => new URLSearchParams(s);

describe('filters <-> URL', () => {
  it('reads every parameter of contracts/routes.md §4', () => {
    expect(filtersFromQuery(q('account=a1&category=c1&status=pending&from=2025-01-01&to=2025-01-31&min=5.00&max=10&q=coffee'))).toEqual({
      account: 'a1', category: 'c1', status: 'pending', from: '2025-01-01', to: '2025-01-31', min: '5.00', max: '10', text: 'coffee',
    });
  });
  it('gives no filters for an empty query and ignores unknown parameters', () => {
    expect(filtersFromQuery(q(''))).toEqual(NO_FILTERS);
    expect(filtersFromQuery(q('new=expense&foo=bar'))).toEqual(NO_FILTERS);
  });
  it('drops invalid values without an error', () => {
    expect(filtersFromQuery(q('status=nope&from=2025-13-40&to=junk'))).toEqual(NO_FILTERS);
  });
  it('writes only what is applied, and keeps other parameters', () => {
    const base = q('new=expense');
    expect(filtersToQuery({ ...NO_FILTERS, account: 'a1', text: 'tea' }, base).toString()).toBe('new=expense&account=a1&q=tea');
    expect(filtersToQuery(NO_FILTERS, q('account=a1&q=x&new=expense')).toString()).toBe('new=expense');
  });
  it('round-trips', () => {
    const f = { ...NO_FILTERS, account: 'a1', category: 'c2', status: 'void' as const, from: '2025-02-01', to: '2025-02-28', min: '1', max: '9', text: 'a b' };
    expect(filtersFromQuery(filtersToQuery(f, q('')))).toEqual(f);
  });
});

describe('chips', () => {
  const labels = { account: (id: string) => `Account ${id}`, category: (id: string) => `Category ${id}`, status: (s: string) => `Status ${s}`, range: (from: string, to: string) => `${from || '…'} – ${to || '…'}`, amount: (min: string, max: string) => `${min || '…'}..${max || '…'}`, text: (s: string) => `“${s}”` };
  it('has one removable chip per applied filter, dates and amounts as a pair', () => {
    const chips = appliedChips({ ...NO_FILTERS, account: 'a1', from: '2025-01-01', min: '5' }, labels);
    expect(chips.map((c) => c.id)).toEqual(['account', 'range', 'amount']);
    expect(chips[1]!.label).toBe('2025-01-01 – …');
  });
  it('removing a chip clears exactly its fields', () => {
    const f = { ...NO_FILTERS, account: 'a1', from: '2025-01-01', to: '2025-01-31', text: 'x' };
    expect(removeFilter(f, 'range')).toEqual({ ...f, from: '', to: '' });
    expect(removeFilter(f, 'account')).toEqual({ ...f, account: '' });
  });
});
