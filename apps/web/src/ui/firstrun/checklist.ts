// The first-run checklist (FR-036): three steps, each done or not as the existing data says. Nothing is stored for it but the dismissal.
export type StepId = 'fold' | 'account' | 'transaction' | 'backup';
export interface Step {
  id: StepId;
  done: boolean;
}

/** `local`: the account is kept only on this device (spec 010), which adds the step that makes the one second copy; `backedUp`: a backup exists. */
export function checklistState(counts: { folds: number; accounts: number; transactions: number; local?: boolean; backedUp?: boolean }): { steps: Step[]; complete: boolean } {
  const steps: Step[] = [
    { id: 'fold', done: counts.folds > 0 },
    { id: 'account', done: counts.accounts > 0 },
    { id: 'transaction', done: counts.transactions > 0 },
    ...(counts.local === true ? [{ id: 'backup' as const, done: counts.backedUp === true }] : []),
  ];
  return { steps, complete: steps.every((s) => s.done) };
}
