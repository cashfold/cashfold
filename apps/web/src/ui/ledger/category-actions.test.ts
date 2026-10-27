import { describe, expect, it, vi } from 'vitest';
import { categoryActions, labelActions } from './category-actions';

const labels = { edit: 'Edit', addChild: 'Add subcategory', moveUp: 'Move up', moveDown: 'Move down', merge: 'Merge', archive: 'Archive', unarchive: 'Restore', remove: 'Delete' };
const run = () => ({ edit: vi.fn(), addChild: vi.fn(), move: vi.fn(), merge: vi.fn(), toggleArchived: vi.fn(), remove: vi.fn() });

describe('the actions of a category row', () => {
  it('are, in order: edit, add subcategory, move up, move down, merge, archive, delete', () => {
    const fns = run();
    expect(categoryActions({ archived: false, index: 1, count: 3, labels, ...fns }).map((a) => a.id)).toEqual(['edit', 'add-child', 'move-up', 'move-down', 'merge', 'archive', 'delete']);
  });

  it('leave out adding a subcategory for a subcategory, which cannot have one', () => {
    const { edit, move, merge, toggleArchived, remove } = run();
    expect(categoryActions({ archived: false, index: 0, count: 1, labels, edit, move, merge, toggleArchived, remove }).map((a) => a.id)).not.toContain('add-child');
  });

  it('offer Restore instead of Archive for an archived category', () => {
    const ids = categoryActions({ archived: true, index: 0, count: 1, labels, ...run() }).map((a) => a.id);
    expect(ids).toContain('unarchive');
    expect(ids).not.toContain('archive');
  });

  it('disable moving up for the first and moving down for the last, and mark only Delete destructive', () => {
    const first = categoryActions({ archived: false, index: 0, count: 2, labels, ...run() });
    expect(first.find((a) => a.id === 'move-up')?.disabled).toBe(true);
    expect(first.find((a) => a.id === 'move-down')?.disabled).toBe(false);
    const last = categoryActions({ archived: false, index: 1, count: 2, labels, ...run() });
    expect(last.find((a) => a.id === 'move-down')?.disabled).toBe(true);
    expect(first.filter((a) => a.destructive).map((a) => a.id)).toEqual(['delete']);
  });

  it('run the function they were given', () => {
    const fns = run();
    categoryActions({ archived: false, index: 1, count: 3, labels, ...fns }).find((a) => a.id === 'merge')!.run();
    categoryActions({ archived: false, index: 1, count: 3, labels, ...fns }).find((a) => a.id === 'move-down')!.run();
    expect(fns.merge).toHaveBeenCalledOnce();
    expect(fns.move).toHaveBeenCalledWith(1);
  });
});

describe('the actions of a payee or tag row', () => {
  it('are edit, merge and delete', () => {
    const fns = run();
    expect(labelActions({ labels, ...fns }).map((a) => a.id)).toEqual(['edit', 'merge', 'delete']);
  });
});
