import { describe, expect, it } from 'vitest';
import { isDirty } from './dirty';

describe('isDirty', () => {
  const initial = { amount: '', account: 'a1', note: '', tags: ['t1'] };
  it('is clean when nothing changed, so closing asks nothing', () => {
    expect(isDirty(initial, { ...initial })).toBe(false);
    expect(isDirty(initial, { ...initial, tags: ['t1'] })).toBe(false);
  });
  it('is dirty when any value differs', () => {
    expect(isDirty(initial, { ...initial, amount: '12' })).toBe(true);
    expect(isDirty(initial, { ...initial, tags: [] })).toBe(true);
  });
  it('compares by value, not identity, and ignores untouched whitespace-only differences in free text', () => {
    expect(isDirty({ note: '' }, { note: '   ' })).toBe(false);
    expect(isDirty({ note: 'a' }, { note: 'a ' })).toBe(false);
    expect(isDirty({ note: 'a' }, { note: 'b' })).toBe(true);
  });
});
