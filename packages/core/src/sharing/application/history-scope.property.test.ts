import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accountBalance } from '../../ledger/application/balance';
import { buildLedger } from '../../ledger/application/projections/ledger';
import { TABLE } from '../../ledger/domain/tables';
import { budgetPeriodAt, buildBudgets } from '../../budgeting/application/budget-period';
import { periodContaining } from '../../budgeting/domain/budget';
import { addDays, type LocalDate } from '../../shared-kernel/local-date';
import { applyOp, emptyFold, isVisible, visibleMembers, type FieldValue, type FoldState, type Op } from '../../sync/domain/merge';
import { LedgerFixture, date } from '../../testing/index';
import { id } from '../../testing/world';
import { baselineAll, baselineDrafts, checkpointDrafts } from './history-scope';

const JOINER = 'JOINER';
const STRUCTURAL = new Set<number>([TABLE.account, TABLE.accountGroup, TABLE.category, TABLE.payee, TABLE.tag, TABLE.budget, TABLE.goal, TABLE.schedule, TABLE.exchangeRate, TABLE.settings]);

/** What the newcomer ends up with: the baseline and the checkpoints, applied to an empty replica as the relay would deliver them. */
function newcomerFrom(full: FoldState, joined: LocalDate): FoldState {
  const fold = id(0xf0);
  const drafts = [...baselineAll(fold, full, joined), ...checkpointDrafts(fold, full, JOINER, joined)];
  let state = emptyFold();
  drafts.forEach((d, n) => {
    const op: Op = { id: id(0x9000 + n), rec: d.rec, dev: id(0xdd), hlc: d.hlc ?? { wallMs: 50_000_000 + n, ctr: 0 }, table: d.table, fields: d.fields, sets: d.sets };
    state = applyOp(state, op);
  });
  return state;
}

describe('baseline republish (FR-102)', () => {
  function structured() {
    const f = new LedgerFixture();
    const main = f.account({ name: 'Main' });
    const pot = f.account({ name: 'Pot', kind: 'goal' });
    const food = f.category({ name: 'Food' });
    const tag = f.nextId();
    f.apply(tag, TABLE.tag, new Map<number, FieldValue>([[1, 'trip'], [2, 3n]]));
    const groupA = f.nextId();
    f.apply(groupA, TABLE.accountGroup, new Map([[1, 'Everyday']]));
    f.apply(main, TABLE.account, new Map(), new Map([[12, { add: [groupA], rem: [] }]]));
    const budget = f.budget({ scope: { categoryIds: [food], tagIds: [tag], accountIds: [main] } });
    f.edit(main, TABLE.account, new Map([[2, 'Main account']]));
    return { f, main, pot, food, tag, budget, groupA };
  }

  it('gives a newcomer the structure with the same values, the same clocks and the same set members', () => {
    const { f } = structured();
    const newcomer = newcomerFrom(f.fold, date(2026, 3, 1));
    for (const [rec, original] of f.fold) {
      if (!STRUCTURAL.has(original.table)) continue;
      const copy = newcomer.get(rec);
      expect(copy, `record ${rec}`).toBeDefined();
      for (const [field, entry] of original.fields) {
        expect(copy!.fields.get(field)?.value).toEqual(entry.value);
        expect(copy!.fields.get(field)?.hlc).toEqual(entry.hlc);
      }
      for (const field of original.sets.keys()) expect([...visibleMembers(copy!, field)].sort()).toEqual([...visibleMembers(original, field)].sort());
    }
  });

  it('changes nothing for members who already have it, however often it is applied', () => {
    const { f } = structured();
    const drafts = [...f.fold].filter(([, s]) => STRUCTURAL.has(s.table)).flatMap(([rec, s]) => baselineDrafts(id(0xf0), rec, s));
    let after = f.fold;
    drafts.forEach((d, n) => {
      const op: Op = { id: id(0x8000 + n), rec: d.rec, dev: id(0xdd), hlc: d.hlc!, table: d.table, fields: d.fields, sets: d.sets };
      after = applyOp(applyOp(after, op), op);
    });
    for (const [rec, original] of f.fold) {
      for (const [field, entry] of original.fields) expect(after.get(rec)!.fields.get(field)?.value).toEqual(entry.value);
      for (const field of original.sets.keys()) expect([...visibleMembers(after.get(rec)!, field)].sort()).toEqual([...visibleMembers(original, field)].sort());
    }
  });

  it('keeps the tags, so a later removal by the newcomer is also a removal for everyone else', () => {
    const { f, main, groupA } = structured();
    const newcomer = newcomerFrom(f.fold, date(2026, 3, 1));
    const seen = newcomer.get(main)!.sets.get(12)!;
    const rem = [...seen.adds.get(groupA)!].map((tag) => [groupA, tag] as const);
    const removal: Op = { id: id(0x7001), rec: main, dev: id(0xdd), hlc: { wallMs: 90_000_000, ctr: 0 }, table: TABLE.account, fields: new Map(), sets: new Map([[12, { add: [], rem }]]) };
    expect([...visibleMembers(applyOp(newcomer, removal).get(main)!, 12)]).toEqual([]);
    expect([...visibleMembers(applyOp(f.fold, removal).get(main)!, 12)]).toEqual([]);
  });

  it('leaves out deleted records and everything that is history', () => {
    const { f, pot } = structured();
    const account = f.account({ name: 'Old' });
    f.transaction(account, { amountMinor: -500n });
    f.remove(pot, TABLE.account);
    const newcomer = newcomerFrom(f.fold, date(2026, 3, 1));
    expect([...newcomer.values()].some((s) => s.table === TABLE.transaction || s.table === TABLE.transfer)).toBe(false);
    expect(newcomer.get(pot) === undefined || !isVisible(newcomer.get(pot)!)).toBe(true);
    expect(newcomer.has(account)).toBe(true);
  });
});

describe('checkpoints give a from_join member the same numbers as the full history (FR-102)', () => {
  const day = fc.integer({ min: 0, max: 400 });
  const amount = fc.integer({ min: 1, max: 90_000 });
  // `existing`: made before the invitation (whatever its date, so it may be dated after the joining day); otherwise made afterwards.
  const entry = fc.record({ on: day, cents: amount, kind: fc.constantFrom('expense', 'expense', 'income', 'transfer'), account: fc.integer({ min: 0, max: 1 }), existing: fc.boolean() });
  const START = date(2026, 1, 1);

  function build(entries: Array<{ on: number; cents: number; kind: string; account: number; existing: boolean }>, joined: LocalDate) {
    const f = new LedgerFixture();
    const accounts = [f.account({ name: 'A', openingBalanceMinor: 1_234n, openingDate: date(2020, 1, 1) }), f.account({ name: 'B', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) })];
    const budgets = (['none', 'carry_positive', 'carry_all'] as const).map((rollover, i) => f.budget({ name: `B${i}`, rollover, limitMinor: 30_000n, anchorLocalDate: date(2026, 1, 1) }));
    const before: Array<() => void> = [];
    const later: Array<() => void> = [];
    for (const e of entries) {
      // Entries made after the invitation are dated from the joining day on (a backdated one would be outside what the newcomer counts).
      const made = addDays(START, e.on);
      const localDate = e.existing || made >= joined ? made : joined;
      const sink = e.existing ? before : later;
      const target = accounts[e.account]!;
      sink.push(() => {
        if (e.kind === 'transfer') f.transfer(target, accounts[1 - e.account]!, { from: BigInt(e.cents), to: BigInt(e.cents), localDate });
        else f.transaction(target, { amountMinor: e.kind === 'expense' ? -BigInt(e.cents) : BigInt(e.cents), localDate, ...(e.kind === 'income' ? { direction: 'income' as const } : {}) });
      });
    }
    return { f, accounts, budgets, before, later };
  }

  it('checkpoint plus later entries equals the full-history balance of every account on every later date', () => {
    fc.assert(fc.property(fc.array(entry, { maxLength: 25 }), fc.integer({ min: 20, max: 300 }), (entries, joinOffset) => {
      const joined = addDays(START, joinOffset);
      const { f, accounts, before, later } = build(entries, joined);
      before.forEach((run) => run());
      const newcomer = newcomerFrom(f.fold, joined);
      // From here on both see the same new entries; the newcomer never saw the older ones.
      const history = f.ops.length;
      later.forEach((run) => run());
      let theirs = newcomer;
      for (const op of f.ops.slice(history)) theirs = applyOp(theirs, { ...op, id: id(0xa000 + f.ops.indexOf(op)) });

      const full = buildLedger(f.fold);
      const partial = buildLedger(theirs, undefined, { member: JOINER });
      for (const account of accounts) {
        for (const offset of [0, 1, 7, 30, 100]) {
          const on = addDays(joined, offset);
          expect(accountBalance(partial, account, on), `account on +${offset}`).toEqual(accountBalance(full, account, on));
        }
        expect(accountBalance(partial, account)).toEqual(accountBalance(full, account));
      }
    }), { numRuns: 60 });
  });

  it('a budget period holding the joining day has the same availability, and every later period is identical', () => {
    fc.assert(fc.property(fc.array(entry, { maxLength: 25 }), fc.integer({ min: 20, max: 300 }), (entries, joinOffset) => {
      const joined = addDays(START, joinOffset);
      const { f, budgets, before, later } = build(entries, joined);
      before.forEach((run) => run());
      const newcomer = newcomerFrom(f.fold, joined);
      const history = f.ops.length;
      later.forEach((run) => run());
      let theirs = newcomer;
      for (const op of f.ops.slice(history)) theirs = applyOp(theirs, { ...op, id: id(0xb000 + f.ops.indexOf(op)) });

      const full = buildLedger(f.fold);
      const partial = buildLedger(theirs, undefined, { member: JOINER });
      const fullBudgets = buildBudgets(f.fold);
      const partialBudgets = buildBudgets(theirs);
      for (const b of budgets) {
        const first = periodContaining(fullBudgets.get(b)!, joined)!.index;
        const startView = budgetPeriodAt(partial, partialBudgets.get(b)!, first);
        const fullView = budgetPeriodAt(full, fullBudgets.get(b)!, first);
        expect(startView.availableMinor).toBe(fullView.availableMinor);
        for (let k = first + 1; k <= first + 8; k++) {
          const p = budgetPeriodAt(partial, partialBudgets.get(b)!, k);
          const q = budgetPeriodAt(full, fullBudgets.get(b)!, k);
          expect({ carry: p.carryInMinor, spent: p.spentMinor, available: p.availableMinor }).toEqual({ carry: q.carryInMinor, spent: q.spentMinor, available: q.availableMinor });
        }
      }
    }), { numRuns: 60 });
  });

  it('without its checkpoints the newcomer would have the wrong numbers (the checkpoints are what makes them right)', () => {
    const joined = date(2026, 2, 1);
    const { f, accounts, before, later } = build([{ on: 5, cents: 700, kind: 'expense', account: 0, existing: true }, { on: 60, cents: 100, kind: 'expense', account: 0, existing: false }], joined);
    before.forEach((run) => run());
    const newcomer = newcomerFrom(f.fold, joined);
    const history = f.ops.length;
    later.forEach((run) => run());
    let theirs = newcomer;
    for (const op of f.ops.slice(history)) theirs = applyOp(theirs, { ...op, id: id(0xc000 + f.ops.indexOf(op)) });
    const full = accountBalance(buildLedger(f.fold), accounts[0]!);
    expect(accountBalance(buildLedger(theirs, undefined, { member: JOINER }), accounts[0]!)).toEqual(full);
    expect(accountBalance(buildLedger(theirs), accounts[0]!)).not.toEqual(full);
    expect(full).toEqual({ ok: true, value: 1_234n - 800n });
  });

  it('members with the full history ignore checkpoints', () => {
    const { f, accounts, before } = build([{ on: 5, cents: 700, kind: 'expense', account: 0, existing: true }], date(2026, 2, 1));
    before.forEach((run) => run());
    const withCheckpoint = newcomerFrom(f.fold, date(2026, 2, 1));
    for (const [rec, s] of withCheckpoint) if (s.table === TABLE.checkpoint) f.apply(rec, TABLE.checkpoint, new Map([...s.fields].map(([k, v]) => [k, v.value])));
    const full = buildLedger(f.fold, undefined, { member: 'SOMEONE_ELSE' });
    expect(accountBalance(full, accounts[0]!)).toEqual({ ok: true, value: 1_234n - 700n });
  });
});
