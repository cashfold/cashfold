import { describe, expect, it } from 'vitest';
import { breakdownHref } from './links';

const period = { from: '2025-03-01', to: '2025-03-31' };

describe('breakdownHref', () => {
  it('links a category row to the filtered list for the period', () => {
    expect(breakdownHref({ kind: 'category', id: 'c1' }, period)).toBe('/transactions/?category=c1&from=2025-03-01&to=2025-03-31');
  });
  it('links a tag row', () => {
    expect(breakdownHref({ kind: 'tag', id: 't1' }, period)).toBe('/transactions/?tag=t1&from=2025-03-01&to=2025-03-31');
  });
  it('links an account row with account=', () => {
    expect(breakdownHref({ kind: 'account', id: 'a1' }, period)).toBe('/transactions/?account=a1&from=2025-03-01&to=2025-03-31');
  });
  it('leaves out the dates of an unbounded period', () => {
    expect(breakdownHref({ kind: 'category', id: 'c1' }, { from: null, to: null })).toBe('/transactions/?category=c1');
  });
  it('encodes ids', () => {
    expect(breakdownHref({ kind: 'category', id: 'a b&c' }, { from: null, to: null })).toBe('/transactions/?category=a+b%26c');
  });
});
