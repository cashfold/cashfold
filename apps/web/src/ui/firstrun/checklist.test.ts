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

describe('checklistState for an account kept only on this device (spec 010, FR-007a)', () => {
  const three = { folds: 1, accounts: 1, transactions: 1 };

  it('is exactly as before without the local option', () => {
    expect(checklistState(three).steps.map((s) => s.id)).toEqual(['fold', 'account', 'transaction']);
    expect(checklistState({ ...three, backedUp: false }).steps).toHaveLength(3);
  });

  it('has a fourth step, "backup", that is done only once a backup exists', () => {
    expect(checklistState({ ...three, local: true, backedUp: false }).steps).toEqual([
      { id: 'fold', done: true }, { id: 'account', done: true }, { id: 'transaction', done: true }, { id: 'backup', done: false },
    ]);
    expect(checklistState({ ...three, local: true, backedUp: true }).steps.at(-1)).toEqual({ id: 'backup', done: true });
  });

  it('is not complete until the backup is made', () => {
    expect(checklistState({ ...three, local: true, backedUp: false }).complete).toBe(false);
    expect(checklistState({ ...three, local: true, backedUp: true }).complete).toBe(true);
    expect(checklistState({ ...three, local: true }).complete).toBe(false);
  });
});

