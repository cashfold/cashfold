import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';
import { cleanName } from './account';
import { CATEGORY_FIELD } from './tables';

export const MAX_CATEGORY_NAME = 80;
export type Direction = 'expense' | 'income';
export const directionCode = (d: Direction): bigint => (d === 'expense' ? 1n : 2n);
export const directionOfCode = (code: unknown): Direction | undefined => (code === 1n ? 'expense' : code === 2n ? 'income' : undefined);

/** Just enough of a category to check the tree rules. */
export interface CategoryNode {
  readonly id: Id;
  readonly direction: Direction;
  readonly parentId: Id | null;
}

export interface NewCategory {
  readonly direction: Direction;
  readonly parentId: Id | null;
  readonly name: string;
  readonly color?: number;
  readonly sortOrder?: number;
}

export type CategoryError = DomainError<
  'invalid_direction' | 'invalid_category_name' | 'unknown_parent' | 'unknown_category' | 'category_depth' | 'category_cycle' | 'category_direction_mismatch'
>;

type Tree = ReadonlyMap<Id, CategoryNode>;

function checkParent(direction: Direction, parentId: Id | null, categories: Tree): Result<true, CategoryError> {
  if (parentId === null) return ok(true as const);
  const parent = categories.get(parentId);
  if (parent === undefined) return err('unknown_parent', 'The parent category does not exist');
  if (parent.parentId !== null) return err('category_depth', 'Categories have at most two levels');
  if (parent.direction !== direction) return err('category_direction_mismatch', 'A category and its parent must both be expense or both income');
  return ok(true as const);
}

export function validateNewCategory(input: NewCategory, categories: Tree): Result<NewCategory, CategoryError> {
  if (input.direction !== 'expense' && input.direction !== 'income') return err('invalid_direction', 'A category is for expenses or for income');
  const name = cleanName(input.name, MAX_CATEGORY_NAME);
  if (name === undefined) return err('invalid_category_name', `A category name has 1 to ${MAX_CATEGORY_NAME} characters and no line breaks`);
  const parent = checkParent(input.direction, input.parentId, categories);
  if (!parent.ok) return parent;
  return ok({ ...input, name });
}

/** Moves a category under another root, or to the top level (parent null). Checks cycles, depth and direction. */
export function validateCategoryMove(category: Id, newParent: Id | null, categories: Tree): Result<true, CategoryError> {
  const moving = categories.get(category);
  if (moving === undefined) return err('unknown_category', 'The category does not exist');
  if (newParent === category) return err('category_cycle', 'A category cannot be its own parent');
  if (newParent !== null && categories.get(newParent)?.parentId === category) return err('category_cycle', 'A category cannot move under its own child');
  const parent = checkParent(moving.direction, newParent, categories);
  if (!parent.ok) return parent;
  const hasChildren = [...categories.values()].some((c) => c.parentId === category);
  if (newParent !== null && hasChildren) return err('category_depth', 'A category with children cannot become a child');
  return ok(true as const);
}

export function categoryFieldPatch(changes: Partial<NewCategory> & { archived?: boolean }): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  if (changes.direction !== undefined) f.set(CATEGORY_FIELD.direction, directionCode(changes.direction));
  if (changes.parentId !== undefined) f.set(CATEGORY_FIELD.parentId, changes.parentId);
  if (changes.name !== undefined) f.set(CATEGORY_FIELD.name, changes.name);
  if (changes.color !== undefined) f.set(CATEGORY_FIELD.color, BigInt(changes.color));
  if (changes.sortOrder !== undefined) f.set(CATEGORY_FIELD.sortOrder, BigInt(changes.sortOrder));
  if (changes.archived !== undefined) f.set(CATEGORY_FIELD.archived, changes.archived);
  return f;
}

export type TreeViolation = 'category_orphan' | 'category_direction_mismatch' | 'category_cycle' | 'category_depth';

/**
 * Categories whose parent link breaks a tree rule after a merge (ARCH 9.5). Concurrent moves on different devices
 * can create a cycle, a third level, or a parent that was deleted, so this runs on merged state. A violating
 * category is read as a top-level one, which every replica does identically.
 */
export function categoryTreeViolations(categories: ReadonlyMap<Id, CategoryNode>): ReadonlyMap<Id, TreeViolation> {
  const out = new Map<Id, TreeViolation>();
  const reachesItself = (start: CategoryNode): boolean => {
    let at: CategoryNode | undefined = start;
    for (let steps = 0; steps <= categories.size && at?.parentId != null; steps++) {
      at = categories.get(at.parentId);
      if (at?.id === start.id) return true;
    }
    return false;
  };
  for (const c of categories.values()) {
    if (c.parentId === null) continue;
    const parent = categories.get(c.parentId);
    if (parent === undefined) out.set(c.id, 'category_orphan');
    else if (parent.direction !== c.direction) out.set(c.id, 'category_direction_mismatch');
    else if (parent.parentId !== null) out.set(c.id, reachesItself(c) ? 'category_cycle' : 'category_depth');
  }
  return out;
}
