import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIELDS, fieldsOf, type FormId } from './fields';
import { DEFAULT_PREFS } from './schema';
import { visibleFields } from './visible-fields';

const ids = (v: ReturnType<typeof visibleFields>, group: string) => v.fields.filter((f) => f.group === group).map((f) => f.def.id);
const prefs = (optionalFields: Record<string, boolean> = {}, moreDetailsOpen = false) => ({ ...DEFAULT_PREFS, optionalFields, moreDetailsOpen });
const expense = { 'tx.kind': 'expense' };

describe('visibleFields for the transaction form', () => {
  it('shows the essential fields and puts the optional ones in More details by default', () => {
    const v = visibleFields('transaction', prefs(), expense, 'new');
    expect(ids(v, 'main')).toEqual(['tx.kind', 'tx.amount', 'tx.account', 'tx.category', 'tx.when']);
    expect(ids(v, 'more')).toEqual(['tx.payee', 'tx.tags', 'tx.note', 'tx.attachment', 'tx.place', 'tx.status', 'tx.pin']);
    expect(ids(v, 'advanced')).toEqual(['tx.coordinates']);
    expect(v.hasMore).toBe(true);
    expect(v.moreOpen).toBe(false);
  });

  it('moves an optional field to the main view when the person turns it on, and only that field', () => {
    const v = visibleFields('transaction', prefs({ 'tx.note': true }), expense, 'new');
    expect(ids(v, 'main')).toContain('tx.note');
    expect(ids(v, 'more')).toContain('tx.payee');
    expect(ids(v, 'more')).not.toContain('tx.note');
  });

  it('opens the group when the person left it open', () => {
    expect(visibleFields('transaction', prefs({}, true), expense, 'new').moreOpen).toBe(true);
  });

  it('keeps a hidden optional field that holds a value reachable in edit mode and opens the group', () => {
    const v = visibleFields('transaction', prefs(), { ...expense, 'tx.note': 'Coffee' }, 'edit');
    expect(ids(v, 'more')).toContain('tx.note');
    expect(v.moreOpen).toBe(true);
    expect(visibleFields('transaction', prefs(), { ...expense, 'tx.note': 'Coffee' }, 'new').moreOpen).toBe(false);
  });

  it('does not open the group for an empty value (empty list, false, empty string)', () => {
    const v = visibleFields('transaction', prefs(), { ...expense, 'tx.tags': [], 'tx.pin': false, 'tx.note': '' }, 'edit');
    expect(v.moreOpen).toBe(false);
  });

  it('applies fields by kind: refund only for income, no category or payee for an adjustment', () => {
    expect(ids(visibleFields('transaction', prefs(), { 'tx.kind': 'income' }, 'new'), 'more')).toContain('tx.refund');
    expect(ids(visibleFields('transaction', prefs(), expense, 'new'), 'more')).not.toContain('tx.refund');
    const adj = visibleFields('transaction', prefs(), { 'tx.kind': 'adjustment' }, 'new');
    const all = adj.fields.map((f) => f.def.id);
    expect(all).not.toContain('tx.category');
    expect(all).not.toContain('tx.payee');
  });

  it('ignores unknown ids in the preferences', () => {
    expect(() => visibleFields('transaction', prefs({ 'zz.nothing': true }), expense, 'new')).not.toThrow();
  });
});

describe('visibleFields for the transfer form', () => {
  it('shows the received amount only when the currencies differ', () => {
    expect(ids(visibleFields('transfer', prefs(), {}, 'new'), 'main')).toEqual(['xf.from', 'xf.to', 'xf.amount', 'xf.when']);
    expect(ids(visibleFields('transfer', prefs(), { 'xf.currenciesDiffer': true }, 'new'), 'main')).toEqual(['xf.from', 'xf.to', 'xf.amount', 'xf.received', 'xf.when']);
    expect(ids(visibleFields('transfer', prefs(), {}, 'new'), 'advanced')).toEqual(['xf.rate']);
  });
});

describe('the registry', () => {
  const forms = [...new Set(FIELDS.map((f) => f.form))] as FormId[];

  it('keeps every form default view at six fields or fewer, not counting the type switch or fields that share a row', () => {
    for (const form of forms) {
      const count = fieldsOf(form).filter((f) => f.cls === 'E' || (f.cls === 'O' && f.defaultVisible)).filter((f) => !f.headerSwitch && !f.sharesRowWith).length;
      expect(count, form).toBeLessThanOrEqual(6);
    }
  });

  it('has each id once, and every id in contracts/form-fields.md', () => {
    const own = FIELDS.map((f) => f.id);
    expect(new Set(own).size).toBe(own.length);
    const contract = readFileSync(resolve(import.meta.dirname, '../../../../../specs/002-ux-redesign-catalyst/contracts/form-fields.md'), 'utf8');
    const named = [...new Set([...contract.matchAll(/`([a-z]{2}\.[a-zA-Z]+)`/g)].map((m) => m[1]!))];
    expect(named.length).toBeGreaterThan(40);
    expect(own.slice().sort()).toEqual(named.slice().sort());
  });

  it('puts technical fields only where the contract says', () => {
    expect(FIELDS.filter((f) => f.cls === 'T').map((f) => f.id).sort()).toEqual(['tx.coordinates', 'xf.rate']);
  });
});
