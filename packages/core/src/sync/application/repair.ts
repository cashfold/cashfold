import type { Id } from '../../shared-kernel/id';
import type { FoldState } from '../domain/merge';
import type { QuarantinedOp } from '../ports/index';

// Deterministic post-merge repair (ARCH 9.5). CRDTs guarantee convergence, not application invariants, so
// each context registers rules that look at the merged state and report violations. A rule is a pure
// function of that state: every replica repairs identically with nothing exchanged. Repair produces data,
// never ops; only user actions create ops (auto-generated ops would make replicas diverge in a loop).

/** `hide`: keep out of lists. `exclude_from_balance`: keep out of balance sums. `flag`: show only in Needs attention. */
export type RepairEffect = 'hide' | 'exclude_from_balance' | 'flag';

export interface Finding {
  readonly kind: string;
  readonly ref?: Id;
  /** i18n key; carries no amounts, names or notes (FR-098). */
  readonly messageKey: string;
  readonly effect?: RepairEffect;
}

export interface RepairRule {
  readonly id: string;
  check(state: FoldState): readonly Finding[];
}

export interface RepairReport {
  readonly findings: readonly Finding[];
  readonly hidden: ReadonlySet<Id>;
  readonly excluded: ReadonlySet<Id>;
}

export interface Repair {
  run(state: FoldState): RepairReport;
}

export interface NeedsAttentionItem {
  readonly kind: string;
  readonly ref?: Id;
  readonly messageKey: string;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareFindings(a: NeedsAttentionItem, b: NeedsAttentionItem): number {
  return compareText(a.kind, b.kind) || compareText(a.ref ?? '', b.ref ?? '') || compareText(a.messageKey, b.messageKey);
}

export function createRepair(rules: readonly RepairRule[]): Repair {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`duplicate repair rule id: ${rule.id}`);
    seen.add(rule.id);
  }

  return {
    run(state) {
      const unique = new Map<string, Finding>();
      for (const rule of rules) {
        let found: readonly Finding[];
        try {
          found = rule.check(state);
        } catch {
          // A defective rule must not take down sync. Surface it so it gets fixed.
          found = [{ kind: 'repair_rule_failed', messageKey: 'attention.repair_rule_failed', effect: 'flag' }];
        }
        for (const f of found) unique.set(`${f.kind}|${f.ref ?? ''}|${f.messageKey}`, f);
      }
      const findings = [...unique.values()].sort(compareFindings);
      const hidden = new Set<Id>();
      const excluded = new Set<Id>();
      for (const f of findings) {
        if (f.ref === undefined) continue;
        if (f.effect === 'hide') hidden.add(f.ref);
        else if (f.effect === 'exclude_from_balance') excluded.add(f.ref);
      }
      return { findings, hidden, excluded };
    },
  };
}

/** The "Needs attention" read model: repair findings plus ops the sync engine quarantined, in a stable order. */
export function buildNeedsAttention(report: RepairReport, quarantined: readonly QuarantinedOp[]): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = report.findings.map((f) => (f.ref === undefined ? { kind: f.kind, messageKey: f.messageKey } : { kind: f.kind, ref: f.ref, messageKey: f.messageKey }));
  for (const q of quarantined) items.push({ kind: 'quarantined_op', ref: q.sealed.op, messageKey: `attention.quarantined.${q.reason}` });
  return items.sort(compareFindings);
}
