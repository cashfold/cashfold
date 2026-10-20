import { describe, expect, it } from 'vitest';
import { LABEL_FIELD } from './tables';
import { labelFieldPatch, labelKey, MAX_LABEL_NAME, validateLabelName } from './label';

describe('labels', () => {
  it('trims and validates a name', () => {
    expect(validateLabelName('  Cafe ')).toEqual({ ok: true, value: 'Cafe' });
    expect(validateLabelName('   ')).toMatchObject({ ok: false, error: { code: 'invalid_label_name' } });
    expect(validateLabelName('x'.repeat(MAX_LABEL_NAME + 1))).toMatchObject({ ok: false });
    expect(validateLabelName('a\nb')).toMatchObject({ ok: false });
  });

  it('compares names without regard to case or accents', () => {
    expect(labelKey('Café')).toBe(labelKey('CAFE'));
    expect(labelKey('Straße')).toBe(labelKey('straße'));
    expect(labelKey('Cafe')).not.toBe(labelKey('Cafes'));
  });

  it('writes only what is given', () => {
    expect([...labelFieldPatch({ name: 'x' }).keys()]).toEqual([LABEL_FIELD.name]);
    expect(labelFieldPatch({ color: 4 }).get(LABEL_FIELD.color)).toBe(4n);
    expect(labelFieldPatch({}).size).toBe(0);
  });
});
