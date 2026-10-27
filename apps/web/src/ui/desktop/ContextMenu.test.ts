import { describe, expect, it, vi } from 'vitest';
import type { RowAction } from '../ledger/row-action';
import { popUpRowActions } from './ContextMenu';

// Outside the desktop app there is no bridge, and nothing is asked or run.
describe('the row context menu', () => {
  const actions = (run: () => void): RowAction[] => [{ id: 'edit', label: 'Edit', run }, { id: 'delete', label: 'Delete', run: vi.fn(), destructive: true }];

  it('does nothing in a browser', async () => {
    const run = vi.fn();
    await popUpRowActions(actions(run), {});
    expect(run).not.toHaveBeenCalled();
  });
});
