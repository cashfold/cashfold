import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { id } from '../../testing/index';
import { CATEGORY_FIELD } from './tables';
import { categoryFieldPatch, validateCategoryMove, validateNewCategory, MAX_CATEGORY_NAME, type CategoryNode } from './category';

const node = (n: number, direction: 'expense' | 'income', parentId: Id | null = null): [Id, CategoryNode] => [id(n), { id: id(n), direction, parentId }];
const tree = (...nodes: Array<[Id, CategoryNode]>): ReadonlyMap<Id, CategoryNode> => new Map(nodes);

describe('Category: creation', () => {
  const food = tree(node(1, 'expense'), node(2, 'expense', id(1)), node(3, 'income'));

  it('creates a root category with no parent', () => {
    const r = validateNewCategory({ direction: 'expense', parentId: null, name: 'Food' }, food);
    expect(r.ok && r.value).toMatchObject({ direction: 'expense', parentId: null, name: 'Food' });
  });

  it('creates a child under a root category of the same direction', () => {
    expect(validateNewCategory({ direction: 'expense', parentId: id(1), name: 'Groceries' }, food).ok).toBe(true);
  });

  it('rejects a child whose parent has the other direction', () => {
    expect(validateNewCategory({ direction: 'expense', parentId: id(3), name: 'x' }, food)).toMatchObject({ ok: false, error: { code: 'category_direction_mismatch' } });
  });

  it('rejects a third level', () => {
    expect(validateNewCategory({ direction: 'expense', parentId: id(2), name: 'x' }, food)).toMatchObject({ ok: false, error: { code: 'category_depth' } });
  });

  it('rejects an unknown parent', () => {
    expect(validateNewCategory({ direction: 'expense', parentId: id(99), name: 'x' }, food)).toMatchObject({ ok: false, error: { code: 'unknown_parent' } });
  });

  it('requires a name of 1 to 80 characters', () => {
    expect(validateNewCategory({ direction: 'expense', parentId: null, name: ' ' }, food)).toMatchObject({ ok: false, error: { code: 'invalid_category_name' } });
    expect(validateNewCategory({ direction: 'expense', parentId: null, name: 'x'.repeat(MAX_CATEGORY_NAME + 1) }, food)).toMatchObject({ ok: false, error: { code: 'invalid_category_name' } });
  });

  it('rejects an unknown direction', () => {
    expect(validateNewCategory({ direction: 'transfer' as never, parentId: null, name: 'x' }, food)).toMatchObject({ ok: false, error: { code: 'invalid_direction' } });
  });
});

describe('Category: moving', () => {
  // 1 Food(root) > 2 Groceries ; 4 Home(root) ; 5 Salary(income root)
  const categories = tree(node(1, 'expense'), node(2, 'expense', id(1)), node(4, 'expense'), node(5, 'income'));

  it('moves a leaf under another root of the same direction', () => {
    expect(validateCategoryMove(id(2), id(4), categories).ok).toBe(true);
  });

  it('moves a child to the top level', () => {
    expect(validateCategoryMove(id(2), null, categories).ok).toBe(true);
  });

  it('refuses to make a category its own parent', () => {
    expect(validateCategoryMove(id(1), id(1), categories)).toMatchObject({ ok: false, error: { code: 'category_cycle' } });
  });

  it('refuses to move a root under its own child (a cycle)', () => {
    expect(validateCategoryMove(id(1), id(2), categories)).toMatchObject({ ok: false, error: { code: 'category_cycle' } });
  });

  it('refuses to nest a root that has children, because that makes a third level', () => {
    expect(validateCategoryMove(id(1), id(4), categories)).toMatchObject({ ok: false, error: { code: 'category_depth' } });
  });

  it('refuses to move across directions', () => {
    expect(validateCategoryMove(id(2), id(5), categories)).toMatchObject({ ok: false, error: { code: 'category_direction_mismatch' } });
  });

  it('refuses an unknown category or parent', () => {
    expect(validateCategoryMove(id(99), null, categories)).toMatchObject({ ok: false, error: { code: 'unknown_category' } });
    expect(validateCategoryMove(id(2), id(99), categories)).toMatchObject({ ok: false, error: { code: 'unknown_parent' } });
  });
});

describe('Category: record fields', () => {
  it('writes direction as 1 expense and 2 income, and a null parent for a root', () => {
    const patch = categoryFieldPatch({ direction: 'income', parentId: null, name: 'Work' });
    expect(patch.get(CATEGORY_FIELD.direction)).toBe(2n);
    expect(patch.get(CATEGORY_FIELD.parentId)).toBeNull();
    expect(patch.get(CATEGORY_FIELD.name)).toBe('Work');
  });
});
