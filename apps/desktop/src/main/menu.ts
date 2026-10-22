import type { Menu, MenuItemConstructorOptions } from 'electron';
import { APP_NAME, RELEASE_PAGE_BASE, SOURCE_REPO_URL } from './identity';

/** The standard application menu. Edit matters most: without it, copy and paste do not work on macOS. */
export function buildMenu(deps: { readonly menu: Pick<typeof Menu, 'buildFromTemplate'>; readonly isMac: boolean; readonly isDev: boolean; readonly openExternal: (url: string) => Promise<void> }): Menu {
  const open = (url: string) => () => void deps.openExternal(url);
  const template: MenuItemConstructorOptions[] = [
    ...(deps.isMac
      ? ([{ label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] as MenuItemConstructorOptions[])
      : ([{ label: 'File', submenu: [{ role: 'quit' }] }] as MenuItemConstructorOptions[])),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        ...(deps.isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[]) : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(deps.isMac ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[]) : ([{ role: 'close' }] as MenuItemConstructorOptions[]))] },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} on GitHub`, click: open(SOURCE_REPO_URL) },
        { label: 'Release notes', click: open(RELEASE_PAGE_BASE) },
        { label: 'Report a problem', click: open(`${SOURCE_REPO_URL}/issues`) },
      ],
    },
  ];
  return deps.menu.buildFromTemplate(template);
}
