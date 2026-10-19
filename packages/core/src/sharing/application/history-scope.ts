import type { Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import { err, ok, type Result } from '../../shared-kernel/result';
import { buildBudgets, envelopeCheckpointValue } from '../../budgeting/application/budget-period';
import { accountBalance } from '../../ledger/application/balance';
import { buildLedger } from '../../ledger/application/projections/ledger';
import { LEDGER_GROUPS } from '../../ledger/domain/ledger-groups';
import { TABLE } from '../../ledger/domain/tables';
import type { OpDraft, WritePath } from '../../sync/application/write-path';
import { isVisible, type FieldValue, type FoldState, type RecordState, type SetDelta } from '../../sync/domain/merge';
import type { Hlc } from '../../sync/domain/hlc';
import type { ProjectionStore } from '../../sync/ports/index';
import { checkpointFields, checkpointId } from '../domain/checkpoint';
import type { HistoryWriter } from './membership-commands';
import type { SharingError } from './membership-log-service';

// History scope for a new member (ARCH 7.6, FR-102). With "from now on" history the Fold moves to a new key epoch and the
// newcomer is given only that key, so nothing written earlier opens for them. Two things make the new epoch usable on its own:
//
//  * a baseline: the structure of the Fold (accounts, categories, payees, tags, budgets, goals, schedules, settings, rates)
//    written again under the new key. Each field keeps the clock that last wrote it, and each set member keeps its tag, so the
//    baseline changes nothing for members who already have it, and later edits by anyone merge exactly as before;
//  * checkpoints: where each account and each budget stood on the joining day, for this member only.

const STRUCTURAL: ReadonlySet<number> = new Set([
  TABLE.account, TABLE.accountGroup, TABLE.category, TABLE.payee, TABLE.tag, TABLE.budget, TABLE.goal, TABLE.schedule, TABLE.exchangeRate, TABLE.settings,
]);

const BATCH = 100;
const clockKey = (h: Hlc): string => `${h.wallMs}:${h.ctr}`;

/** The ops that restate one record: its fields grouped by the clock that wrote them, its live set members under their own tags. */
export function baselineDrafts(fold: Id, rec: Id, state: RecordState): OpDraft[] {
  const buckets = new Map<string, { hlc: Hlc; fields: Map<number, FieldValue>; sets: Map<number, SetDelta> }>();
  const bucket = (hlc: Hlc) => {
    const key = clockKey(hlc);
    let b = buckets.get(key);
    if (b === undefined) {
      b = { hlc, fields: new Map(), sets: new Map() };
      buckets.set(key, b);
    }
    return b;
  };
  let newest: Hlc | undefined;
  for (const [field, entry] of state.fields) {
    bucket(entry.hlc).fields.set(field, entry.value);
    if (newest === undefined || entry.hlc.wallMs > newest.wallMs || (entry.hlc.wallMs === newest.wallMs && entry.hlc.ctr > newest.ctr)) newest = entry.hlc;
  }
  // Set members have no clock of their own; they travel with the newest field write of the record.
  for (const [field, set] of state.sets) {
    const live: Array<readonly [Id, Id]> = [];
    for (const [member, tags] of set.adds) for (const tag of tags) if (set.removed.get(member)?.has(tag) !== true) live.push([member, tag]);
    if (live.length > 0 && newest !== undefined) bucket(newest).sets.set(field, { add: [], rem: [], tagged: live });
  }
  // A group of fields is written whole or not at all: move any group the clocks have split into the newest op that holds part of it.
  const ordered = [...buckets.values()].sort((a, b) => a.hlc.wallMs - b.hlc.wallMs || a.hlc.ctr - b.hlc.ctr);
  for (const group of LEDGER_GROUPS.get(state.table) ?? []) {
    const holders = ordered.filter((b) => group.some((f) => b.fields.has(f)));
    if (holders.length < 2) continue;
    const target = holders.at(-1)!;
    for (const b of holders.slice(0, -1)) for (const f of group) if (b.fields.has(f)) { target.fields.set(f, b.fields.get(f)!); b.fields.delete(f); }
  }
  return ordered.filter((b) => b.fields.size > 0 || b.sets.size > 0).map((b) => ({ fold, rec, table: state.table, fields: b.fields, sets: b.sets, hlc: b.hlc }));
}

/** Where each account and each budget stood on the joining day, written for one member (FR-102). */
export function checkpointDrafts(fold: Id, records: FoldState, joiner: string, joined: LocalDate): OpDraft[] {
  const ledger = buildLedger(records);
  const none = new Map<number, SetDelta>();
  const drafts: OpDraft[] = [];
  for (const account of ledger.accounts.values()) {
    const balance = accountBalance(ledger, account.id, joined);
    if (!balance.ok) continue; // a balance beyond 64 bits cannot be written down
    drafts.push({
      fold, rec: checkpointId(fold, 'account_balance', account.id, joiner), table: TABLE.checkpoint, sets: none,
      fields: checkpointFields({ kind: 'account_balance', subject: account.id, asOf: joined, valueMinor: balance.value, member: joiner }),
    });
  }
  for (const budget of buildBudgets(records).values()) {
    const value = envelopeCheckpointValue(ledger, budget, joined);
    if (value === undefined) continue;
    drafts.push({
      fold, rec: checkpointId(fold, 'envelope_carry', budget.id, joiner), table: TABLE.checkpoint, sets: none,
      fields: checkpointFields({ kind: 'envelope_carry', subject: budget.id, asOf: joined, valueMinor: value, member: joiner }),
    });
  }
  return drafts;
}

export function createHistoryWriter(deps: { projections: ProjectionStore; writePath: WritePath }): HistoryWriter {
  const { projections, writePath } = deps;
  return {
    async baseline({ fold, joiner, joinedLocalDate }): Promise<Result<{ records: number; checkpoints: number }, SharingError>> {
      const records = await projections.listRecords(fold);
      const drafts: OpDraft[] = [];
      let restated = 0;
      for (const [rec, state] of records) {
        if (!STRUCTURAL.has(state.table) || !isVisible(state)) continue;
        // A record that is deleted stays out: the newcomer has no use for it, and a restore of it will find no base to land on.
        const own = baselineDrafts(fold, rec, state);
        if (own.length > 0) restated += 1;
        drafts.push(...own);
      }

      const cp = checkpointDrafts(fold, records, joiner, joinedLocalDate as LocalDate);
      drafts.push(...cp);
      const checkpoints = cp.length;

      for (let i = 0; i < drafts.length; i += BATCH) {
        const written = await writePath.submitMany(drafts.slice(i, i + BATCH));
        if (!written.ok) return err('log_invalid', `The Fold's current state could not be written for the new member: ${written.error.code}`);
      }
      return ok({ records: restated, checkpoints });
    },
  };
}
