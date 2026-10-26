import type { Menu, MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from './identity';

/**
 * The application menu. Windows and Linux have none (null clears it, and Alt shows nothing). macOS cannot do without the menu named after the
 * app, so it keeps that one: About, Hide and Quit, and nothing else. Clipboard, window and zoom shortcuts are in shortcuts.ts.
 */
export function buildMenu(deps: { readonly menu: Pick<typeof Menu, 'buildFromTemplate'>; readonly isMac: boolean }): Menu | null {
  if (!deps.isMac) return null;
  const template: MenuItemConstructorOptions[] = [
    { label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
  ];
  return deps.menu.buildFromTemplate(template);
}
