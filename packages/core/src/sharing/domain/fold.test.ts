import { describe, expect, it } from 'vitest';
import { id } from '../../testing/world';
import { FOLD_SETTINGS_FIELDS, foldSettingsPatch, settingsRecordId, validateFoldName, validateNewFold } from './fold';

describe('Fold name', () => {
  it('is trimmed and 1 to 80 characters', () => {
    expect(validateFoldName('  Household  ')).toEqual({ ok: true, value: 'Household' });
    expect(validateFoldName('x'.repeat(80)).ok).toBe(true);
    expect(validateFoldName('x'.repeat(81))).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_fold_name' }) });
    expect(validateFoldName('   ').ok).toBe(false);
    expect(validateFoldName('').ok).toBe(false);
  });

  it('counts what a person sees: an emoji is one character', () => {
    expect(validateFoldName('🏠'.repeat(80)).ok).toBe(true);
    expect(validateFoldName('🏠'.repeat(81)).ok).toBe(false);
  });

  it('rejects control characters', () => {
    expect(validateFoldName('a\u0000b').ok).toBe(false);
    expect(validateFoldName('a\nb').ok).toBe(false);
  });
});

describe('new Fold', () => {
  it('needs a valid name and a known base currency', () => {
    expect(validateNewFold({ name: 'Personal', baseCurrency: 'USD' })).toEqual({ ok: true, value: { name: 'Personal', baseCurrency: 'USD' } });
    expect(validateNewFold({ name: 'Personal', baseCurrency: 'usd' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'unknown_currency' }) });
    expect(validateNewFold({ name: 'Personal', baseCurrency: 'ZZZ' }).ok).toBe(false);
    expect(validateNewFold({ name: '', baseCurrency: 'EUR' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_fold_name' }) });
  });
});

describe('Fold settings record', () => {
  it('has a stable id derived from the Fold id, so every device addresses the same record', () => {
    const fold = id(0xf1);
    expect(settingsRecordId(fold)).toBe(settingsRecordId(fold));
    expect(settingsRecordId(fold)).not.toBe(settingsRecordId(id(0xf2)));
    expect(settingsRecordId(fold)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab]/); // UUIDv5
  });

  it('writes name and base currency as one op: table 13, fields 1 and 2', () => {
    const patch = foldSettingsPatch({ name: 'Personal', baseCurrency: 'USD' });
    expect(patch.table).toBe(13);
    expect([...patch.fields]).toEqual([[FOLD_SETTINGS_FIELDS.name, 'Personal'], [FOLD_SETTINGS_FIELDS.baseCurrency, 'USD']]);
  });

  it('can write just the name for a rename', () => {
    expect([...foldSettingsPatch({ name: 'Renamed' }).fields]).toEqual([[FOLD_SETTINGS_FIELDS.name, 'Renamed']]);
  });
});
