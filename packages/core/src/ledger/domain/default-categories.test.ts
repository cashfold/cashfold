import { describe, expect, it } from 'vitest';
import { id } from '../../testing/index';
import { defaultCategories } from './default-categories';

describe('default categories with starter names (FR-015)', () => {
  const fold = id(0xf0);
  const english = defaultCategories(fold);

  it('gives the same ids, keys, parents and order whatever names are supplied', () => {
    const names = Object.fromEntries(english.map((c) => [c.key, `${c.key}!`]));
    const named = defaultCategories(fold, names);
    expect(named.map((c) => [c.key, c.id, c.parentId, c.sortOrder])).toEqual(english.map((c) => [c.key, c.id, c.parentId, c.sortOrder]));
  });

  it('uses a supplied name for its key and the English name for a key it does not mention', () => {
    const named = defaultCategories(fold, { 'expense.food': 'Jedzenie i napoje' });
    expect(named.find((c) => c.key === 'expense.food')!.name).toBe('Jedzenie i napoje');
    expect(named.find((c) => c.key === 'expense.home')!.name).toBe('Home');
    expect(named.find((c) => c.key === 'expense.food.groceries')!.name).toBe('Groceries');
  });

  it('ignores a blank name and keeps the English one', () => {
    expect(defaultCategories(fold, { 'expense.food': '   ' }).find((c) => c.key === 'expense.food')!.name).toBe('Food & Drink');
  });
});
