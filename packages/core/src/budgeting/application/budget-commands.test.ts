import { beforeEach, describe, expect, it } from 'vitest';
import { createRepair } from '../../sync/application/repair';
import { LedgerFixture, date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from '../../ledger/application/account-commands';
import { createCategoryCommands } from '../../ledger/application/category-commands';
import { TABLE } from '../../ledger/domain/tables';
import { createBudgetCommands } from './budget-commands';
import { buildBudgets } from './budget-period';
import { budgetingRepairRules } from './repair-rules';

const budgets = createBudgetCommands();
let h: LedgerHarness;
const read = async () => buildBudgets(await h.replica.projections.listRecords(h.fold));
const base = { fold: undefined as never, id: id(40), name: 'Groceries', direction: 'expense' as const, periodUnit: 'month' as const, anchorLocalDate: date(2026, 1, 1), limitMinor: 30_000n, currency: 'USD' };

beforeEach(async () => {
  h = await ledgerHarness();
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
  await h.run(createCategoryCommands().createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Food' });
});

describe('budget commands', () => {
  it('creates a budget with its scope and numbers it after the others', async () => {
    expect((await h.run(budgets.createBudget, { ...base, fold: h.fold, scope: { accountIds: [id(1)], categoryIds: [id(60)], includeTransfers: true } })).ok).toBe(true);
    await h.run(budgets.createBudget, { ...base, fold: h.fold, id: id(41), name: 'Fun' });
    const all = [...(await read()).values()];
    expect(all.map((b) => b.name)).toEqual(['Groceries', 'Fun']);
    expect(all[0]).toMatchObject({ allocationMinor: 30_000n, scope: { accountIds: [id(1)], categoryIds: [id(60)], tagIds: [], groupIds: [], includeTransfers: true } });
  });

  it('refuses invalid input, an existing id and a scope that points at nothing', async () => {
    expect(await h.run(budgets.createBudget, { ...base, fold: h.fold, limitMinor: -1n })).toMatchObject({ ok: false, error: { code: 'invalid_limit' } });
    await h.run(budgets.createBudget, { ...base, fold: h.fold });
    expect(await h.run(budgets.createBudget, { ...base, fold: h.fold })).toMatchObject({ ok: false, error: { code: 'budget_exists' } });
    expect(await h.run(budgets.createBudget, { ...base, fold: h.fold, id: id(42), scope: { tagIds: [id(99)] } })).toMatchObject({ ok: false, error: { code: 'unknown_scope_member' } });
    expect(await h.run(budgets.createBudget, { ...base, fold: h.fold, id: id(42), fundedFromAccountId: id(98) })).toMatchObject({ ok: false, error: { code: 'unknown_funding_account' } });
  });

  it('updates fields and replaces scope sets without touching the rest', async () => {
    await h.run(budgets.createBudget, { ...base, fold: h.fold, scope: { categoryIds: [id(60)], accountIds: [id(1)] } });
    const r = await h.run(budgets.updateBudget, { fold: h.fold, id: id(40), changes: { rollover: 'carry_positive', limitMinor: 50_000n }, scope: { accountIds: [] } });
    expect(r).toMatchObject({ ok: true });
    expect((await read()).get(id(40))).toMatchObject({ rollover: 'carry_positive', limitMinor: 50_000n, allocationMinor: 50_000n, scope: { accountIds: [], categoryIds: [id(60)] } });
    expect(await h.run(budgets.updateBudget, { fold: h.fold, id: id(40), changes: { periodInterval: 0 } })).toMatchObject({ ok: false, error: { code: 'invalid_interval' } });
    expect(await h.run(budgets.updateBudget, { fold: h.fold, id: id(77), changes: {} })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('deleting a budget leaves the transactions alone', async () => {
    await h.run(budgets.createBudget, { ...base, fold: h.fold });
    expect(await h.run(budgets.deleteBudget, { fold: h.fold, id: id(40) })).toMatchObject({ ok: true });
    expect((await read()).size).toBe(0);
    expect(await h.run(budgets.deleteBudget, { fold: h.fold, id: id(40) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect([...(await h.ledger()).accounts.keys()]).toEqual([id(1)]);
  });

  it('a viewer cannot change budgets', async () => {
    h.setRole('viewer');
    expect((await h.run(budgets.createBudget, { ...base, fold: h.fold })).ok).toBe(false);
  });
});

describe('budget repair rules', () => {
  const run = (f: LedgerFixture) => createRepair(budgetingRepairRules).run(f.fold);

  it('flags a scope member that no longer exists, without hiding the budget', () => {
    const f = new LedgerFixture();
    const cat = f.category();
    const b = f.budget({ scope: { categoryIds: [cat] } });
    expect(run(f).findings).toEqual([]);
    f.remove(cat, TABLE.category);
    const report = run(f);
    expect(report.findings).toMatchObject([{ kind: 'budget_scope_orphan', ref: b, effect: 'flag' }]);
    expect(report.hidden.has(b)).toBe(false);
  });

  it('hides a malformed budget record', () => {
    const f = new LedgerFixture();
    const rec = f.nextId();
    f.apply(rec, TABLE.budget, new Map([[1, 'no limit']]));
    expect(run(f).hidden.has(rec)).toBe(true);
  });
});
