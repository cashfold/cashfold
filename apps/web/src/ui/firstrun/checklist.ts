// The first-run checklist (FR-036): three steps, each done or not as the existing data says. Nothing is stored for it but the dismissal.
export type StepId = 'fold' | 'account' | 'transaction';
export interface Step {
  id: StepId;
  done: boolean;
}

export function checklistState(counts: { folds: number; accounts: number; transactions: number }): { steps: Step[]; complete: boolean } {
  const steps: Step[] = [
    { id: 'fold', done: counts.folds > 0 },
    { id: 'account', done: counts.accounts > 0 },
    { id: 'transaction', done: counts.transactions > 0 },
  ];
  return { steps, complete: steps.every((s) => s.done) };
}
