import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { foldToJson, wireOpFromJson, type Json } from '../../testing/fixtures';
import { applyOpInto, validateOp, type RecordState } from '../domain/merge';
import type { WireOp } from '../ports/index';
import { createUpcasters } from './upcasters';
import { SCHEMA_VERSION, toMergeOp } from './write-path';

const dir = resolve(import.meta.dirname, '../../../../../vectors/ops');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as { schema: number; ops: Json[]; expected?: Json };

const op = (schema: number, fields: [number, bigint][] = []): WireOp => ({
  fold: 'f' as Id, op: 'o' as Id, rec: 'r' as Id, dev: 'd' as Id, seq: 1n, hlc: { wallMs: 1, ctr: 0 }, epoch: 1, schema, table: 6,
  fields: new Map(fields), sets: new Map(),
});

/** Test registry with a synthetic 0 -> 1 step: the legacy amount field 50 became field 5. */
const legacyStep = (o: WireOp): WireOp => ({
  ...o, schema: 1,
  fields: new Map([...o.fields].map(([f, v]) => [f === 50 ? 5 : f, v])),
});

describe('createUpcasters', () => {
  it('passes current-schema ops through unchanged', () => {
    const up = createUpcasters(1, new Map());
    const o = op(1, [[5, 1n]]);
    expect(up.upcast(o)).toEqual({ ok: true, value: o });
  });

  it('applies steps in order from the op schema up to current', () => {
    const calls: number[] = [];
    const steps = new Map([
      [1, (o: WireOp) => (calls.push(1), { ...o, schema: 2 })],
      [2, (o: WireOp) => (calls.push(2), { ...o, schema: 3 })],
    ]);
    const up = createUpcasters(3, steps);
    expect(up.upcast(op(1))).toMatchObject({ ok: true, value: { schema: 3 } });
    expect(calls).toEqual([1, 2]);
    calls.length = 0;
    expect(up.upcast(op(2))).toMatchObject({ ok: true, value: { schema: 3 } });
    expect(calls).toEqual([2]);
  });

  it('rejects ops newer than this build understands (they are quarantined, not guessed at)', () => {
    expect(createUpcasters(1, new Map()).upcast(op(2))).toEqual({ ok: false, error: expect.objectContaining({ code: 'schema_unsupported' }) });
  });

  it('rejects ops older than the oldest supported schema', () => {
    const up = createUpcasters(2, new Map([[1, (o: WireOp) => ({ ...o, schema: 2 })]]));
    expect(up.upcast(op(0))).toEqual({ ok: false, error: expect.objectContaining({ code: 'schema_unsupported' }) });
  });

  it('refuses to build a registry with a gap in the chain', () => {
    const step = (o: WireOp) => o;
    expect(() => createUpcasters(4, new Map([[1, step], [3, step]]))).toThrow(/gap/);
    expect(() => createUpcasters(2, new Map([[2, step]]))).toThrow(/current/);
  });

  it('treats a step that does not advance the version by exactly one as a defect', () => {
    const up = createUpcasters(2, new Map([[1, (o: WireOp) => ({ ...o, schema: 1 })]]));
    expect(() => up.upcast(op(1))).toThrow(/advance/);
  });
});

function replay(file: string, upcasters = createUpcasters(SCHEMA_VERSION, new Map())): Json {
  const state = new Map<Id, RecordState>();
  for (const json of load(file).ops) {
    const upcast = upcasters.upcast(wireOpFromJson(json));
    if (!upcast.ok) throw new Error(upcast.error.message);
    const merge = toMergeOp(upcast.value);
    const valid = validateOp(merge, new Map());
    if (!valid.ok) throw new Error(valid.error.message);
    applyOpInto(state, merge);
  }
  return foldToJson(state);
}

describe('frozen op fixtures replay to the same projected state (Constitution V)', () => {
  const baseline = 'schema-1-baseline.json';

  it('schema 1 baseline matches its golden state', () => {
    const actual = replay(baseline);
    if (process.env['UPDATE_FIXTURES']) {
      const file = load(baseline);
      writeFileSync(resolve(dir, baseline), `${JSON.stringify({ ...file, expected: actual }, null, 2)}\n`);
    }
    expect(actual).toEqual(load(baseline).expected);
    expect((load(baseline).expected as Json[]).length).toBeGreaterThan(0);
  });

  it('golden state reflects the intended merge outcomes', () => {
    const expected = load(baseline).expected as { rec: string; fields: [number, { value: unknown }][]; sets: [number, { removed: unknown[] }][] }[];
    const txn = expected.find((r) => r.rec.endsWith('103'))!;
    const field = (id: number) => txn.fields.find(([f]) => f === id)?.[1].value;
    expect(field(5)).toEqual({ $bigint: '-500' }); // device B's later amount edit won
    expect(field(6)).toBe('Coffee beans (organic)'); // device A's concurrent note edit survived
    expect(txn.sets.find(([f]) => f === 20)![1].removed).toHaveLength(1); // tag 0x201's add was observed-removed
    const big = expected.find((r) => r.rec.endsWith('104'))!;
    expect(big.fields.find(([f]) => f === 5)![1].value).toEqual({ $bigint: '9223372036854775807' }); // exact i64 max
    expect(big.fields.find(([f]) => f === 65535)![1].value).toBe(false); // restore after delete
  });

  it('a schema 0 fixture upcast through its step replays to the identical state', () => {
    const upcasters = createUpcasters(1, new Map([[0, legacyStep]]));
    expect(replay('schema-0-legacy-amount.json', upcasters)).toEqual(load(baseline).expected);
  });

  it('without the step a schema 0 op is refused rather than silently misread', () => {
    expect(() => replay('schema-0-legacy-amount.json')).toThrow(/schema/i);
  });
});
