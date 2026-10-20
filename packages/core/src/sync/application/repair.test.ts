import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { createReplica, createWorld, id } from '../../testing/index';
import { applyOp, emptyFold, type FieldValue, type FoldState, type Op } from '../domain/merge';
import type { QuarantinedOp } from '../ports/index';
import { buildNeedsAttention, createRepair, type Finding, type RepairRule } from './repair';

const op = (n: number, rec: Id, fields: [number, FieldValue][], table = 6): Op => ({
  id: id(0x900 + n), rec, dev: id(0xa), hlc: { wallMs: n, ctr: 0 }, table, fields: new Map(fields), sets: new Map(),
});
const stateOf = (...ops: Op[]): FoldState => ops.reduce(applyOp, emptyFold());

/** Flags transactions (table 6) that have no account reference (field 1). */
const orphanRule: RepairRule = {
  id: 'txn.orphan',
  check(state) {
    return [...state]
      .filter(([, r]) => r.table === 6 && !r.fields.has(1))
      .map(([rec]): Finding => ({ kind: 'orphan_transaction', ref: rec, messageKey: 'attention.orphan_transaction', effect: 'hide' }));
  },
};
const currencyRule: RepairRule = {
  id: 'txn.currency',
  check(state) {
    return [...state]
      .filter(([, r]) => r.fields.get(9)?.value === 'XXX')
      .map(([rec]): Finding => ({ kind: 'currency_mismatch', ref: rec, messageKey: 'attention.currency_mismatch', effect: 'exclude_from_balance' }));
  },
};

describe('createRepair', () => {
  it('reports nothing for a healthy state and for no rules', () => {
    const healthy = stateOf(op(1, id(1), [[1, 'acc']]));
    expect(createRepair([orphanRule]).run(healthy)).toEqual({ findings: [], hidden: new Set(), excluded: new Set() });
    expect(createRepair([]).run(healthy)).toEqual({ findings: [], hidden: new Set(), excluded: new Set() });
  });

  it('collects findings and derives the hidden and excluded sets from their effects', () => {
    const state = stateOf(op(1, id(1), [[2, 'no account']]), op(2, id(2), [[1, 'acc'], [9, 'XXX']]), op(3, id(3), [[1, 'ok']]));
    const report = createRepair([orphanRule, currencyRule]).run(state);
    expect(report.findings.map((f) => [f.kind, f.ref])).toEqual([['currency_mismatch', id(2)], ['orphan_transaction', id(1)]]);
    expect(report.hidden).toEqual(new Set([id(1)]));
    expect(report.excluded).toEqual(new Set([id(2)]));
  });

  it('deduplicates identical findings', () => {
    const twice: RepairRule = { id: 'dup', check: () => [{ kind: 'k', messageKey: 'm' }, { kind: 'k', messageKey: 'm' }] };
    expect(createRepair([twice]).run(emptyFold()).findings).toHaveLength(1);
  });

  it('rejects duplicate rule ids', () => {
    expect(() => createRepair([orphanRule, orphanRule])).toThrow(/duplicate/i);
  });

  it('contains a failing rule: it becomes a finding and the other rules still run', () => {
    const broken: RepairRule = { id: 'broken', check: () => { throw new Error('boom'); } };
    const state = stateOf(op(1, id(1), [[2, 'x']]));
    const report = createRepair([broken, orphanRule]).run(state);
    expect(report.findings.map((f) => f.kind)).toEqual(['orphan_transaction', 'repair_rule_failed']);
    expect(report.findings.find((f) => f.kind === 'repair_rule_failed')?.messageKey).toBe('attention.repair_rule_failed');
  });

  it('is a pure function of the state: rule order and state iteration order do not matter', () => {
    const arb = fc.array(fc.tuple(fc.integer({ min: 1, max: 6 }), fc.boolean(), fc.boolean()), { maxLength: 12 });
    fc.assert(
      fc.property(arb, (rows) => {
        const ops = rows.map(([n, hasAccount, mismatch], i) =>
          op(i + 1, id(n), [...(hasAccount ? [[1, 'acc'] as [number, FieldValue]] : []), ...(mismatch ? [[9, 'XXX'] as [number, FieldValue]] : [])]));
        const forward = stateOf(...ops);
        const backward = stateOf(...[...ops].reverse());
        const a = createRepair([orphanRule, currencyRule]).run(forward);
        const b = createRepair([currencyRule, orphanRule]).run(backward);
        expect(b).toEqual(a);
      }),
    );
  });
});

describe('replicas repair identically without exchanging anything', () => {
  it('two replicas with the same ops in different order produce the same report', async () => {
    const world = await createWorld();
    const fold = id(0xf1);
    world.addFold(fold);
    const a = await createReplica(world, { device: id(0xa) });
    const b = await createReplica(world, { device: id(0xb) });
    await a.writePath.submit({ fold, rec: id(1), table: 6, fields: new Map([[2, 'orphan']]), sets: new Map() });
    await a.writePath.submit({ fold, rec: id(2), table: 6, fields: new Map([[1, 'fine']]), sets: new Map() });
    await b.writePath.submit({ fold, rec: id(3), table: 6, fields: new Map([[2, 'another orphan']]), sets: new Map() });
    for (const s of await a.oplog.list(fold)) await b.writePath.applyRemote(s.sealed);
    for (const s of [...(await b.oplog.list(fold))].reverse()) await a.writePath.applyRemote(s.sealed);

    const repair = createRepair([orphanRule]);
    const reportA = repair.run(await a.projections.listRecords(fold));
    const reportB = repair.run(await b.projections.listRecords(fold));
    expect(reportA).toEqual(reportB);
    expect(reportA.findings).toHaveLength(2);
    // Repair never writes: no new ops appeared.
    expect(await a.oplog.list(fold)).toHaveLength(3);
  });
});

describe('buildNeedsAttention', () => {
  const quarantined = (reason: QuarantinedOp['reason'], n: number): QuarantinedOp => ({
    reason, atMs: n,
    sealed: { fold: id(1), op: id(0x700 + n), rec: id(1), dev: id(2), seq: 1n, hlc: { wallMs: 1, ctr: 0 }, epoch: 1, schema: 1, blob: new Uint8Array(0), sig: new Uint8Array(0) },
  });

  it('merges repair findings and quarantined ops into one deterministic, content-free list', () => {
    const report = createRepair([orphanRule]).run(stateOf(op(1, id(1), [[2, 'x']])));
    const items = buildNeedsAttention(report, [quarantined('bad_signature', 2), quarantined('clock_ahead', 1)]);
    expect(items).toEqual([
      { kind: 'orphan_transaction', ref: id(1), messageKey: 'attention.orphan_transaction' },
      { kind: 'quarantined_op', ref: id(0x701), messageKey: 'attention.quarantined.clock_ahead' },
      { kind: 'quarantined_op', ref: id(0x702), messageKey: 'attention.quarantined.bad_signature' },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/"blob"|"sig"|"fields"|"amount"|"note"/);
  });

  it('is empty when everything is healthy', () => {
    expect(buildNeedsAttention(createRepair([]).run(emptyFold()), [])).toEqual([]);
  });
});

describe('ordering of findings', () => {
  it('sorts by kind, then reference, then message key, and puts findings without a reference first within a kind', () => {
    const rule: RepairRule = {
      id: 'mixed',
      check: () => [
        { kind: 'k', ref: id(2), messageKey: 'b' },
        { kind: 'k', messageKey: 'z' },
        { kind: 'k', ref: id(1), messageKey: 'b' },
        { kind: 'k', ref: id(1), messageKey: 'a' },
        { kind: 'a', messageKey: 'm' },
      ],
    };
    const items = buildNeedsAttention(createRepair([rule]).run(emptyFold()), []);
    expect(items.map((i) => [i.kind, i.ref, i.messageKey])).toEqual([
      ['a', undefined, 'm'], ['k', undefined, 'z'], ['k', id(1), 'a'], ['k', id(1), 'b'], ['k', id(2), 'b'],
    ]);
  });

  it('ignores effects on findings that point at nothing', () => {
    const rule: RepairRule = { id: 'x', check: () => [{ kind: 'k', messageKey: 'm', effect: 'hide' }] };
    expect(createRepair([rule]).run(emptyFold()).hidden.size).toBe(0);
  });
});
