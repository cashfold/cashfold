import { describe, expect, it, vi } from 'vitest';
import { accountActions } from './account-actions';

const labels = { add: 'Add transaction', adjust: 'Adjust balance', edit: 'Edit', moveUp: 'Move Cash up', moveDown: 'Move Cash down', moveToGroup: (name: string) => `Move to ${name}`, moveToUngrouped: 'Move to Ungrouped', currentGroup: (name: string) => `${name} (current group)`, currentUngrouped: 'Ungrouped (current group)', archive: 'Archive', unarchive: 'Restore', remove: 'Delete' };
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

describe('the move-to-group actions', () => {
  const groups = [{ id: 'g1', name: 'Household' }, { id: 'g2', name: 'Savings' }];
  const withGroups = (over: Record<string, unknown> = {}) => ({ ...base(), groups, currentGroup: undefined, moveToGroup: vi.fn(), ...over });
  const ids = (actions: Array<{ id: string }>) => actions.map((a) => a.id);

  it('come after Edit: one per group, then Ungrouped', () => {
    const actions = accountActions(withGroups({ currentGroup: 'g2' }));
    expect(ids(actions)).toEqual(['add', 'adjust', 'edit', 'move-to:g1', 'move-to:g2', 'move-to:none', 'move-up', 'move-down', 'archive', 'delete']);
    expect(actions.find((a) => a.id === 'move-to:g1')!.label).toBe('Move to Household');
    expect(actions.find((a) => a.id === 'move-to:none')!.label).toBe('Move to Ungrouped');
  });

  it('disable the current group and say so', () => {
    const actions = accountActions(withGroups({ currentGroup: 'g2' }));
    const current = actions.find((a) => a.id === 'move-to:g2')!;
    expect(current.disabled).toBe(true);
    expect(current.label).toBe('Savings (current group)');
    expect(actions.find((a) => a.id === 'move-to:g1')!.disabled).toBeUndefined();
    expect(actions.find((a) => a.id === 'move-to:none')!.disabled).toBeUndefined();
  });

  it('disable Ungrouped when the account has no group', () => {
    const none = accountActions(withGroups()).find((a) => a.id === 'move-to:none')!;
    expect(none.disabled).toBe(true);
    expect(none.label).toBe('Ungrouped (current group)');
  });

  it('are absent with no groups, leaving the list as it was', () => {
    expect(ids(accountActions({ ...base(), groups: [], currentGroup: undefined, moveToGroup: vi.fn() }))).toEqual(['add', 'adjust', 'edit', 'move-up', 'move-down', 'archive', 'delete']);
  });

  it('run moveToGroup with the group id, or null for Ungrouped', () => {
    const h = withGroups({ currentGroup: 'g1' });
    const actions = accountActions(h);
    actions.find((a) => a.id === 'move-to:g2')!.run();
    actions.find((a) => a.id === 'move-to:none')!.run();
    expect(h.moveToGroup.mock.calls).toEqual([['g2'], [null]]);
  });

  it('have ids that start with move-to:, so the desktop pop-up (which takes short plain ids and at most 12 items) can leave them out', () => {
    const moves = accountActions(withGroups()).filter((a) => a.id.startsWith('move-to:'));
    expect(moves).toHaveLength(3);
    for (const a of accountActions(withGroups()).filter((x) => !x.id.startsWith('move-to:'))) expect(a.id).toMatch(/^[a-z][a-z-]{0,23}$/);
  });
});
