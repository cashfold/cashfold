'use client';

import { useCallback, type MouseEvent } from 'react';
import { isDesktopApp } from '../../adapters/platform/detect';
import type { RowAction } from '../ledger/row-action';

/**
 * Asks the desktop shell for a native pop-up menu with the actions of a row, and runs the one that is chosen. In a browser it does nothing, so the
 * browser's own menu stays. The context-menu key and Shift+F10 raise the same `contextmenu` event, so they work too.
 */
export async function popUpRowActions(actions: readonly RowAction[], host: object = globalThis): Promise<void> {
  try {
    const bridge = (await import('../../adapters/platform')).getDesktopBridge(host);
    if (bridge === undefined) return;
    const id = await bridge.popupMenu(actions.map(({ id: itemId, label, destructive, disabled }) => ({ id: itemId, label, ...(destructive === true ? { destructive } : {}), ...(disabled === true ? { disabled } : {}) })));
    const chosen = actions.find((action) => action.id === id);
    if (chosen !== undefined && chosen.disabled !== true) chosen.run();
  } catch {
    // The menu is a convenience: the row's actions button still has every action.
  }
}

export function useRowContextMenu(actions: readonly RowAction[]): (event: MouseEvent) => void {
  return useCallback(
    (event) => {
      if (!isDesktopApp()) return;
      event.preventDefault();
      void popUpRowActions(actions);
    },
    [actions],
  );
}
