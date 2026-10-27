import { describe, expect, it, vi } from 'vitest';
import { transactionActions, transferActions } from './row-actions';

const labels = { edit: 'Edit', pin: 'Pin', unpin: 'Unpin', remove: 'Delete' };
const handlers = () => ({ edit: vi.fn(), togglePin: vi.fn(), remove: vi.fn() });

// The same ids, in the same order, as the dropdown the row has always had (edit, pin or unpin, delete): the right-click menu is drawn from this list too.
describe('the actions of a transaction row', () => {
  it('are edit, pin and delete for a row that is not pinned', () => {
    const actions = transactionActions({ pinned: false, labels, ...handlers() });
    expect(actions.map((a) => [a.id, a.label])).toEqual([['edit', 'Edit'], ['pin', 'Pin'], ['delete', 'Delete']]);
  });

  it('offer unpin for a row that is pinned', () => {
    expect(transactionActions({ pinned: true, labels, ...handlers() }).map((a) => a.id)).toEqual(['edit', 'unpin', 'delete']);
  });

  it('flag only delete as destructive, and run the handler they were given', () => {
    const h = handlers();
    const actions = transactionActions({ pinned: false, labels, ...h });
    expect(actions.filter((a) => a.destructive === true).map((a) => a.id)).toEqual(['delete']);
    actions.find((a) => a.id === 'pin')!.run();
    actions.find((a) => a.id === 'delete')!.run();
    expect(h.togglePin).toHaveBeenCalledOnce();
    expect(h.remove).toHaveBeenCalledOnce();
    expect(h.edit).not.toHaveBeenCalled();
  });

  it('use ids the native menu accepts', () => {
    for (const a of [...transactionActions({ pinned: true, labels, ...handlers() }), ...transferActions({ labels, edit: vi.fn(), remove: vi.fn() })]) {
      expect(a.id).toMatch(/^[a-z][a-z-]{0,23}$/);
      expect(a.label.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('the actions of a transfer row', () => {
  it('are edit and delete, with delete destructive', () => {
    const actions = transferActions({ labels, edit: vi.fn(), remove: vi.fn() });
    expect(actions.map((a) => [a.id, a.destructive === true])).toEqual([['edit', false], ['delete', true]]);
  });
});
