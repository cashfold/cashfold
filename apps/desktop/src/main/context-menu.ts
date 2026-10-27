import type { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import { PopupMenuRequestSchema, type PopupMenuRequest } from '@cashfold/platform';

// A native pop-up menu for a row (a transaction, an account). The page sends only labels and ids; the shell shows them at the pointer and answers
// with the id that was chosen, or null. It carries no row data, and what an id does is the page's business.

export interface ContextMenuDeps {
  readonly menu: Pick<typeof Menu, 'buildFromTemplate'>;
  readonly window: () => BrowserWindow | undefined;
}

/** Shows the menu and resolves with the chosen id, or null when it was closed without a choice (or the request is not valid). */
export function popupContextMenu(deps: ContextMenuDeps, items: PopupMenuRequest['items']): Promise<string | null> {
  // The bridge has checked this already; a menu is cheap to refuse again.
  const parsed = PopupMenuRequestSchema.safeParse({ items });
  const win = deps.window();
  if (!parsed.success || win === undefined || win.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const template: MenuItemConstructorOptions[] = parsed.data.items.map((item) => ({
      label: item.label,
      enabled: item.disabled !== true,
      click: () => resolve(item.id),
    }));
    // The choice is reported before the menu's "closed" callback on some systems and after it on others: let a click win.
    deps.menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => resolve(null), 0) });
  });
}
