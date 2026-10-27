import { describe, expect, it, vi } from 'vitest';
import { accountActions } from './account-actions';

const labels = { add: 'Add transaction', adjust: 'Adjust balance', edit: 'Edit', moveUp: 'Move Cash up', moveDown: 'Move Cash down', archive: 'Archive', unarchive: 'Restore', remove: 'Delete' };
const base = () => ({ archived: false, index: 1, count: 3, labels, add: vi.fn(), adjust: vi.fn(), edit: vi.fn(), move: vi.fn(), toggleArchived: vi.fn(), remove: vi.fn() });

// The same set, in the same order, as the account's dropdown has always had.
describe('the actions of an account row', () => {
  it('are add, adjust, edit, move up, move down, archive and delete', () => {
    expect(accountActions(base()).map((a) => a.id)).toEqual(['add', 'adjust', 'edit', 'move-up', 'move-down', 'archive', 'delete']);
  });

  it('offer restore for an archived account', () => {
    const actions = accountActions({ ...base(), archived: true });
    expect(actions.map((a) => a.id)).toContain('unarchive');
    expect(actions.map((a) => a.id)).not.toContain('archive');
  });

  it('disable move up for the first account of its kind and move down for the last', () => {
    const disabled = (index: number, count: number) => accountActions({ ...base(), index, count }).filter((a) => a.disabled === true).map((a) => a.id);
    expect(disabled(0, 3)).toEqual(['move-up']);
    expect(disabled(2, 3)).toEqual(['move-down']);
    expect(disabled(0, 1)).toEqual(['move-up', 'move-down']);
    expect(disabled(1, 3)).toEqual([]);
  });

  it('move in the direction the action names, and flag only delete as destructive', () => {
    const h = base();
    const actions = accountActions(h);
    actions.find((a) => a.id === 'move-up')!.run();
    actions.find((a) => a.id === 'move-down')!.run();
    expect(h.move.mock.calls).toEqual([[-1], [1]]);
    expect(actions.filter((a) => a.destructive === true).map((a) => a.id)).toEqual(['delete']);
  });

  it('use ids the native menu accepts', () => {
    for (const a of accountActions(base())) expect(a.id).toMatch(/^[a-z][a-z-]{0,23}$/);
  });
});
