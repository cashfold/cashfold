import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { toMergeOp } from '../../sync/application/write-path';
import { applyOpInto, validateOp, type Op, type RecordState } from '../../sync/domain/merge';
import { LedgerFixture, date, id, wireOpFromJson, wireOpToJson, type Json } from '../../testing/index';
import { LEDGER_GROUPS } from '../domain/ledger-groups';
import { LABEL_FIELD, TABLE, TXN_FIELD } from '../domain/tables';
import { accountBalance } from './balance';
import { buildLedger, type Ledger } from './projections/ledger';

// The field numbers of ledger records are part of the wire format: devices on different versions exchange them. This
// fixture is a frozen set of ops written with schema 1. Replaying it must keep producing the same ledger, so a
// renumbered field or a changed encoding fails here instead of silently misreading users' data (Constitution V).
// Regenerate deliberately with UPDATE_FIXTURES=1 only when adding a new schema version; never edit it by hand.

const file = resolve(import.meta.dirname, '../../../../../vectors/ops/schema-1-ledger.json');
const FOLD = id(0xf0);

function scenario(): Op[] {
  const f = new LedgerFixture('USD');
  const checking = f.account({ name: 'Checking', openingBalanceMinor: 100_000n, openingDate: date(2026, 1, 1) }, id(0x101));
  const euro = f.account({ name: 'Euro', currency: 'EUR' as never, openingBalanceMinor: 5_000n, openingDate: date(2026, 1, 1), sortOrder: 1 }, id(0x102));
  const food = f.category({ name: 'Food', direction: 'expense' }, id(0x201));
  const groceries = f.category({ name: 'Groceries', direction: 'expense', parentId: food }, id(0x202));
  const salary = f.category({ name: 'Salary', direction: 'income' }, id(0x203));
  f.apply(id(0x301), TABLE.payee, new Map([[LABEL_FIELD.name, 'Corner shop']]));
  f.apply(id(0x401), TABLE.tag, new Map([[LABEL_FIELD.name, 'weekly']]));
  f.apply(id(0x402), TABLE.tag, new Map([[LABEL_FIELD.name, 'cash']]));
  f.exchangeRate({ quote: 'EUR' as never, asOfUtcS: 1_767_225_600, rateE12: 900_000_000_000n as never, source: 'custom' }, id(0x501));

  const at = (m: number, d: number) => ({ localDate: date(2026, m, d), occurredUtcMs: Date.UTC(2026, m - 1, d, 12) });
  f.transaction(checking, { amountMinor: -1_234n, categoryId: groceries, payeeId: id(0x301), note: 'Weekly shop', tagIds: [id(0x401), id(0x402)], ...at(1, 5) }, id(0x601));
  f.transaction(checking, { amountMinor: 250_000n, direction: 'income', categoryId: salary, ...at(1, 25) }, id(0x602));
  f.transaction(checking, { amountMinor: -999n, status: 'pending', ...at(2, 1) }, id(0x603));
  f.transaction(checking, { amountMinor: -111n, status: 'void', ...at(2, 2) }, id(0x604));
  f.transaction(checking, { amountMinor: -777n, ...at(2, 3) }, id(0x605));
  f.remove(id(0x605), TABLE.transaction);
  f.transaction(checking, { amountMinor: 4_000_000_000_000_000_000n, direction: 'income', ...at(3, 1) }, id(0x606));
  f.transaction(checking, { amountMinor: 300n, direction: 'adjustment', ...at(3, 2) }, id(0x607));
  f.transaction(euro, { amountMinor: -900n, currency: 'EUR' as never, baseAmountMinor: -1_000n, fxRateId: id(0x501), ...at(1, 10) }, id(0x608));
  f.edit(id(0x601), TABLE.transaction, new Map([[TXN_FIELD.note, 'Weekly shop (edited)']]));
  return f.ops;
}

/** Everything a person could see, as plain JSON. */
function summarise(ledger: Ledger): Json {
  return {
    base: ledger.baseCurrency ?? null,
    accounts: [...ledger.accounts.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => ({
      name: a.name, kind: a.kind, currency: a.currency, opening: a.openingBalanceMinor.toString(),
      balance: (() => { const b = accountBalance(ledger, a.id); return b.ok ? b.value.toString() : 'overflow'; })(),
    })),
    categories: [...ledger.categories.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => ({ name: c.name, direction: c.direction, parent: c.parentId })),
    payees: [...ledger.payees.values()].map((p) => p.name),
    tags: [...ledger.tags.values()].map((t) => t.name).sort(),
    transactions: [...ledger.transactions.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((t) => ({
      id: t.id, direction: t.direction, amount: t.amountMinor.toString(), base: t.baseAmountMinor.toString(), currency: t.currency,
      status: t.status, localDate: t.localDate, note: t.note, tags: [...t.tagIds].sort(), category: t.categoryId, payee: t.payeeId, fx: t.fxRateId,
    })),
    deleted: [...ledger.deleted.keys()],
    rates: ledger.rates.map((r) => ({ quote: r.quote, rate: r.rateE12.toString(), source: r.source })),
  };
}

function replay(ops: readonly Json[]): Ledger {
  const state = new Map<Id, RecordState>();
  for (const json of ops) {
    const op = toMergeOp(wireOpFromJson(json));
    const valid = validateOp(op, LEDGER_GROUPS);
    if (!valid.ok) throw new Error(valid.error.message);
    applyOpInto(state, op);
  }
  return buildLedger(state);
}

const wire = (op: Op, seq: number): Json =>
  wireOpToJson({ fold: FOLD, op: op.id, rec: op.rec, dev: op.dev, seq: BigInt(seq), hlc: op.hlc, epoch: 1, schema: 1, table: op.table, fields: op.fields, sets: op.sets });

if (process.env['UPDATE_FIXTURES']) {
  const ops = scenario().map((op, i) => wire(op, i + 1));
  writeFileSync(file, `${JSON.stringify({
    description: 'Schema 1 ledger: accounts, categories, a payee, tags, a rate, and transactions of every status, a deletion, an edit, an adjustment and the largest amounts.',
    schema: 1, ops, expected: summarise(replay(ops)),
  }, null, 2)}\n`);
}

describe('the frozen ledger fixture (schema 1)', () => {
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as { schema: number; ops: Json[]; expected: Json };

  it('replays to the ledger it was written with', () => {
    expect(fixture.schema).toBe(1);
    expect(summarise(replay(fixture.ops))).toEqual(fixture.expected);
  });

  it('is the same however the ops arrive', () => {
    expect(summarise(replay([...fixture.ops].reverse()))).toEqual(fixture.expected);
    const shuffled = [...fixture.ops].sort((a, b) => ((a as { op: string }).op.slice(-3) < (b as { op: string }).op.slice(-3) ? 1 : -1));
    expect(summarise(replay(shuffled))).toEqual(fixture.expected);
  });

  it('still says what the people in it can see', () => {
    const e = fixture.expected as { accounts: Array<{ name: string; balance: string }>; deleted: string[]; transactions: Array<{ note: string; tags: string[] }>; tags: string[] };
    expect(e.accounts.map((a) => [a.name, a.balance])).toEqual([
      ['Checking', (100_000n - 1_234n + 250_000n + 4_000_000_000_000_000_000n + 300n).toString()],
      ['Euro', (5_000n - 900n).toString()],
    ]);
    expect(e.deleted).toEqual([id(0x605)]);
    expect(e.transactions.find((t) => t.note.startsWith('Weekly'))?.note).toBe('Weekly shop (edited)');
    expect(e.tags).toEqual(['cash', 'weekly']);
  });

  it('the scenario that wrote it still produces the same ops (guards the generator, not the data)', () => {
    expect(scenario().map((op, i) => wire(op, i + 1))).toEqual(fixture.ops);
  });
});
