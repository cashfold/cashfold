import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import type { FieldEntry, FieldValue, RecordState } from '../../sync/domain/merge';
import type { FoldSummary } from '../ports/index';
import { summaryFromSettings } from './fold-settings';

const entry = (value: FieldValue): FieldEntry => ({ hlc: { wallMs: 1, ctr: 0 }, dev: id(1), opId: id(2), value });
const settings = (fields: [number, FieldValue][]): RecordState => ({ table: 13, tableConflict: false, fields: new Map(fields.map(([f, v]) => [f, entry(v)])), sets: new Map() });
const prev: FoldSummary = { id: id(0xf0), name: 'Syncing…', baseCurrency: 'USD', epoch: 1, role: 'owner' };

describe('summaryFromSettings', () => {
  it('takes the merged name and base currency, keeping the key epoch and role', () => {
    expect(summaryFromSettings(prev, settings([[1, 'Household'], [2, 'EUR']]))).toEqual({ ...prev, name: 'Household', baseCurrency: 'EUR' });
  });

  it('reports no change when the directory already agrees', () => {
    expect(summaryFromSettings({ ...prev, name: 'Household', baseCurrency: 'EUR' }, settings([[1, 'Household'], [2, 'EUR']]))).toBeUndefined();
  });

  it('ignores a missing, mistyped or invalid field and keeps the rest', () => {
    expect(summaryFromSettings(prev, settings([[1, 5n], [2, 'ZZZ']]))).toBeUndefined();
    expect(summaryFromSettings(prev, settings([[1, '   '], [2, 'GBP']]))).toEqual({ ...prev, baseCurrency: 'GBP' });
    expect(summaryFromSettings(prev, settings([[1, 'x'.repeat(200)]]))).toBeUndefined();
    expect(summaryFromSettings(prev, settings([]))).toBeUndefined();
  });
});
