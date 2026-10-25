import { beforeEach, describe, expect, it } from 'vitest';
import { LedgerFixture, date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { defaultCategories } from '../domain/default-categories';
import { createAccountCommands } from './account-commands';
import { createCategoryCommands, createLabelCommands, labelUsage } from './category-commands';
import { createTransactionCommands } from './transaction-commands';
import { buildLedger } from './projections/ledger';

const accounts = createAccountCommands();
const categories = createCategoryCommands();
const labels = createLabelCommands();
let h: LedgerHarness;
const txns = () => createTransactionCommands({ clock: { nowMs: () => h.clock.now } });
const MARCH = Date.UTC(2026, 2, 1, 12);

const spend = (n: number, over: Record<string, unknown> = {}) => h.run(txns().addTransaction, {
  fold: h.fold, id: id(n), accountId: id(1), direction: 'expense' as const, amountMinor: -100n, currency: 'USD', occurredUtcMs: MARCH, tzOffsetMin: 0, ...over,
});

beforeEach(async () => {
  h = await ledgerHarness();
  await h.run(accounts.createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
});

describe('default categories', () => {
  it('has two levels, income and expense, and a stable id for every entry', () => {
    const set = defaultCategories(id(0xf0));
    const byId = new Map(set.map((c) => [c.id, c]));
    expect(byId.size).toBe(set.length);
    for (const c of set) if (c.parentId !== null) expect(byId.get(c.parentId)?.parentId).toBeNull();
    expect(set.filter((c) => c.direction === 'income' && c.parentId === null).map((c) => c.key)).toEqual(['income.work', 'income.investment', 'income.other']);
    expect(set.filter((c) => c.direction === 'expense' && c.parentId === null)).toHaveLength(9);
    expect(defaultCategories(id(0xf0)).map((c) => c.id)).toEqual(set.map((c) => c.id));
    expect(defaultCategories(id(0xf1)).map((c) => c.id)).not.toEqual(set.map((c) => c.id));
  });

  it('is created once as ordinary editable records', async () => {
    const first = await h.run(categories.seedDefaultCategories, { fold: h.fold });
    expect(first.ok && first.value).toBe(defaultCategories(h.fold).length);
    const ledger = await h.ledger();
    const food = defaultCategories(h.fold).find((c) => c.key === 'expense.food')!;
    expect(ledger.categories.get(food.id)).toMatchObject({ name: 'Food & Drink', parentId: null, direction: 'expense' });

    // User edits survive a second seeding (another device doing the same thing).
    await h.run(categories.updateCategory, { fold: h.fold, id: food.id, changes: { name: 'Eating' } });
    expect(await h.run(categories.seedDefaultCategories, { fold: h.fold })).toEqual({ ok: true, value: 0 });
    expect((await h.ledger()).categories.get(food.id)!.name).toBe('Eating');
  });

  it('seeds with the names it is given, under the same ids as the English set', async () => {
    const food = defaultCategories(h.fold).find((c) => c.key === 'expense.food')!;
    const seeded = await h.run(categories.seedDefaultCategories, { fold: h.fold, names: { 'expense.food': 'Їжа та напої' } });
    expect(seeded.ok && seeded.value).toBe(defaultCategories(h.fold).length);
    const ledger = await h.ledger();
    expect(ledger.categories.get(food.id)).toMatchObject({ name: 'Їжа та напої', parentId: null });
    expect(ledger.categories.size).toBe(defaultCategories(h.fold).length);
  });

  it('seeding on two devices converges on the same records', async () => {
    const a = new LedgerFixture();
    const b = new LedgerFixture();
    for (const f of [a, b]) for (const c of defaultCategories(id(0xf0))) f.category({ direction: c.direction, parentId: c.parentId, name: c.name }, c.id);
    expect(buildLedger(a.fold).categories.size).toBe(defaultCategories(id(0xf0)).length);
    expect([...buildLedger(a.fold).categories.keys()].sort()).toEqual([...buildLedger(b.fold).categories.keys()].sort());
  });
});

describe('category commands', () => {
  beforeEach(async () => {
    await h.run(categories.createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Food' });
    await h.run(categories.createCategory, { fold: h.fold, id: id(61), direction: 'expense', parentId: id(60), name: 'Groceries' });
    await h.run(categories.createCategory, { fold: h.fold, id: id(62), direction: 'expense', parentId: null, name: 'Home' });
  });

  it('refuses a third level and an unknown parent', async () => {
    expect(await h.run(categories.createCategory, { fold: h.fold, id: id(70), direction: 'expense', parentId: id(61), name: 'Deep' })).toMatchObject({ ok: false, error: { code: 'category_depth' } });
    expect(await h.run(categories.createCategory, { fold: h.fold, id: id(70), direction: 'expense', parentId: id(99), name: 'Lost' })).toMatchObject({ ok: false, error: { code: 'unknown_parent' } });
  });

  it('numbers siblings in order', async () => {
    await h.run(categories.createCategory, { fold: h.fold, id: id(63), direction: 'expense', parentId: id(60), name: 'Coffee' });
    const c = (await h.ledger()).categories;
    expect(c.get(id(63))!.sortOrder).toBeGreaterThan(c.get(id(61))!.sortOrder);
  });

  it('renames, recolours, archives', async () => {
    await h.run(categories.updateCategory, { fold: h.fold, id: id(60), changes: { name: 'Eating out', color: 3, archived: true } });
    expect((await h.ledger()).categories.get(id(60))).toMatchObject({ name: 'Eating out', color: 3, archived: true });
    expect(await h.run(categories.updateCategory, { fold: h.fold, id: id(60), changes: { name: ' ' } })).toMatchObject({ ok: false, error: { code: 'invalid_category_name' } });
  });

  it('moves a child under another root and refuses cycles', async () => {
    expect((await h.run(categories.moveCategory, { fold: h.fold, id: id(61), parentId: id(62) })).ok).toBe(true);
    expect((await h.ledger()).categories.get(id(61))!.parentId).toBe(id(62));
    expect(await h.run(categories.moveCategory, { fold: h.fold, id: id(62), parentId: id(61) })).toMatchObject({ ok: false, error: { code: 'category_cycle' } });
  });

  it('will not delete a category that is in use, but deletes an unused one', async () => {
    await spend(10, { categoryId: id(61) });
    expect(await h.run(categories.deleteCategory, { fold: h.fold, id: id(61) })).toMatchObject({ ok: false, error: { code: 'category_in_use' } });
    expect(await h.run(categories.deleteCategory, { fold: h.fold, id: id(60) })).toMatchObject({ ok: false, error: { code: 'category_in_use' } }); // has a child
    expect((await h.run(categories.deleteCategory, { fold: h.fold, id: id(62) })).ok).toBe(true);
  });

  describe('merging', () => {
    it('reassigns every transaction and keeps the totals the same', async () => {
      await spend(10, { categoryId: id(61) });
      await spend(11, { categoryId: id(60) });
      await spend(12, { categoryId: id(62) });
      const r = await h.run(categories.mergeCategories, { fold: h.fold, from: id(62), into: id(60) });
      expect(r).toEqual({ ok: true, value: { reassigned: 1 } });
      const ledger = await h.ledger();
      expect(ledger.categories.has(id(62))).toBe(false);
      expect([...ledger.transactions.values()].map((t) => t.categoryId).sort()).toEqual([id(60), id(60), id(61)].sort());
    });

    it('moves the children of the merged category to the target', async () => {
      await h.run(categories.mergeCategories, { fold: h.fold, from: id(60), into: id(62) });
      expect((await h.ledger()).categories.get(id(61))!.parentId).toBe(id(62));
    });

    it('refuses to merge into itself, across directions, into its own child, or where children would sink to level three', async () => {
      await h.run(categories.createCategory, { fold: h.fold, id: id(64), direction: 'income', parentId: null, name: 'Pay' });
      expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(60), into: id(60) })).toMatchObject({ ok: false, error: { code: 'merge_into_self' } });
      expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(60), into: id(64) })).toMatchObject({ ok: false, error: { code: 'merge_direction_mismatch' } });
      expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(60), into: id(61) })).toMatchObject({ ok: false, error: { code: 'category_cycle' } });
      await h.run(categories.moveCategory, { fold: h.fold, id: id(61), parentId: id(62) });
      await h.run(categories.createCategory, { fold: h.fold, id: id(65), direction: 'expense', parentId: id(60), name: 'Bakery' });
      expect(await h.run(categories.mergeCategories, { fold: h.fold, from: id(60), into: id(61) })).toMatchObject({ ok: false, error: { code: 'category_depth' } });
    });
  });
});

describe('payees and tags', () => {
  beforeEach(async () => {
    for (const [n, name] of [[80, 'Cafe'], [81, 'Café']] as const) await h.run(labels.createPayee, { fold: h.fold, id: id(n), name });
    for (const [n, name] of [[90, 'fun'], [91, 'treat']] as const) await h.run(labels.createTag, { fold: h.fold, id: id(n), name });
  });

  it('creates and renames, with a validated name', async () => {
    expect(await h.run(labels.createPayee, { fold: h.fold, id: id(82), name: '' })).toMatchObject({ ok: false, error: { code: 'invalid_label_name' } });
    await h.run(labels.updatePayee, { fold: h.fold, id: id(80), name: 'The Cafe', color: 2 });
    expect((await h.ledger()).payees.get(id(80))).toMatchObject({ name: 'The Cafe', color: 2 });
  });

  it('counts usage locally', async () => {
    await spend(10, { payeeId: id(80), tagIds: [id(90), id(91)] });
    await spend(11, { payeeId: id(80), tagIds: [id(90)] });
    const r = await h.ask(labelUsage, { fold: h.fold });
    expect(r.ok && [r.value.payees.get(id(80)), r.value.tags.get(id(90)), r.value.tags.get(id(91))]).toEqual([2, 2, 1]);
  });

  it('merges payees: every transaction is repointed and the old payee goes', async () => {
    await spend(10, { payeeId: id(81) });
    await spend(11, { payeeId: id(80) });
    expect(await h.run(labels.mergePayees, { fold: h.fold, from: id(81), into: id(80) })).toEqual({ ok: true, value: { reassigned: 1 } });
    const ledger = await h.ledger();
    expect(ledger.payees.has(id(81))).toBe(false);
    expect([...ledger.transactions.values()].map((t) => t.payeeId)).toEqual([id(80), id(80)]);
  });

  it('merges tags without doubling a tag already on the transaction', async () => {
    await spend(10, { tagIds: [id(90), id(91)] });
    await spend(11, { tagIds: [id(91)] });
    await h.run(labels.mergeTags, { fold: h.fold, from: id(91), into: id(90) });
    const t = (await h.ledger()).transactions;
    expect(t.get(id(10))!.tagIds).toEqual([id(90)]);
    expect(t.get(id(11))!.tagIds).toEqual([id(90)]);
  });

  it('refuses to merge into itself or with something that does not exist', async () => {
    expect(await h.run(labels.mergeTags, { fold: h.fold, from: id(90), into: id(90) })).toMatchObject({ ok: false, error: { code: 'merge_into_self' } });
    expect(await h.run(labels.mergePayees, { fold: h.fold, from: id(80), into: id(99) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('deleting a label clears it from transactions instead of leaving a dangling reference', async () => {
    await spend(10, { payeeId: id(80), tagIds: [id(90)] });
    expect(await h.run(labels.deletePayee, { fold: h.fold, id: id(80) })).toEqual({ ok: true, value: { cleared: 1 } });
    expect(await h.run(labels.deleteTag, { fold: h.fold, id: id(90) })).toEqual({ ok: true, value: { cleared: 1 } });
    const t = (await h.ledger()).transactions.get(id(10))!;
    expect([t.payeeId, t.tagIds]).toEqual([null, []]);
  });
});
