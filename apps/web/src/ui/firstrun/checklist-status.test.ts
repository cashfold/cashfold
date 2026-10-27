import { describe, expect, it } from 'vitest';
import { checklistStatus } from './checklist-status';

describe('whether getting started has steps left', () => {
  it('is unknown until the counts are', () => {
    expect(checklistStatus(undefined)).toMatchObject({ known: false, complete: false });
  });

  it('has steps left while any count is zero', () => {
    expect(checklistStatus({ folds: 1, accounts: 0, transactions: 0 })).toMatchObject({ known: true, complete: false });
    expect(checklistStatus({ folds: 1, accounts: 1, transactions: 0 })).toMatchObject({ known: true, complete: false });
    expect(checklistStatus({ folds: 0, accounts: 1, transactions: 1 })).toMatchObject({ known: true, complete: false });
  });

  it('is complete when a Fold, an account and a transaction exist', () => {
    const status = checklistStatus({ folds: 1, accounts: 2, transactions: 5 });
    expect(status).toMatchObject({ known: true, complete: true });
    expect(status.steps.every((s) => s.done)).toBe(true);
  });
});
