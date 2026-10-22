import { describe, expect, it } from 'vitest';
import { checklistState } from './checklist';

describe('checklistState', () => {
  it('marks steps done from existing data', () => {
    expect(checklistState({ folds: 1, accounts: 0, transactions: 0 }).steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(checklistState({ folds: 1, accounts: 2, transactions: 0 }).steps.map((s) => s.done)).toEqual([true, true, false]);
  });
  it('is complete only when every step is', () => {
    expect(checklistState({ folds: 1, accounts: 1, transactions: 1 }).complete).toBe(true);
    expect(checklistState({ folds: 1, accounts: 1, transactions: 0 }).complete).toBe(false);
  });
  it('lists the steps in order', () => {
    expect(checklistState({ folds: 0, accounts: 0, transactions: 0 }).steps.map((s) => s.id)).toEqual(['fold', 'account', 'transaction']);
  });
});
