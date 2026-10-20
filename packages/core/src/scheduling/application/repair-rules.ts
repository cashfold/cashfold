import type { Id } from '../../shared-kernel/id';
import type { Finding, RepairRule } from '../../sync/application/repair';
import { isVisible, type FoldState } from '../../sync/domain/merge';
import { TABLE } from '../../ledger/domain/tables';
import { isTombstoned } from '../../ledger/domain/records';
import { decodeSchedule } from '../domain/schedule';
import { validateTemplate } from '../domain/schedule';

// Schedules are plans: a damaged one is reported, never hidden, and it creates nothing it cannot create correctly.

const finding = (kind: string, ref: Id, effect: Finding['effect']): Finding => ({ kind, ref, messageKey: `attention.${kind}`, ...(effect !== undefined && { effect }) });

const accountsOf = (state: FoldState): Set<Id> => {
  const out = new Set<Id>();
  for (const [rec, s] of state) if (s.table === TABLE.account && isVisible(s)) out.add(rec);
  return out;
};

/** A schedule whose template points at an account that is gone, or breaks the template rules after a merge. */
const invalidSchedule: RepairRule = {
  id: 'scheduling.invalid_schedule',
  check(state) {
    const accounts = accountsOf(state);
    const found: Finding[] = [];
    for (const [rec, s] of state) {
      if (s.table !== TABLE.schedule || !isVisible(s)) continue;
      const schedule = decodeSchedule(rec, s);
      if (schedule === undefined) continue;
      const t = schedule.template;
      const missing = t.kind === 'transaction' ? !accounts.has(t.accountId) : !accounts.has(t.fromAccountId) || !accounts.has(t.toAccountId);
      const broken = !validateTemplate(t).ok || (schedule.endLocalDate !== null && schedule.endLocalDate < schedule.beginLocalDate);
      if (missing || broken) found.push(finding('schedule_invalid', rec, 'flag'));
    }
    return found;
  },
};

const malformedSchedule: RepairRule = {
  id: 'scheduling.malformed_schedule',
  check(state) {
    const found: Finding[] = [];
    for (const [rec, s] of state) {
      if (s.table !== TABLE.schedule || isTombstoned(s)) continue;
      if (decodeSchedule(rec, s) === undefined) found.push(finding('malformed_record', rec, 'hide'));
    }
    return found;
  },
};

export const schedulingRepairRules: readonly RepairRule[] = [invalidSchedule, malformedSchedule];
