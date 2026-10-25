import type { Menu, MenuItemConstructorOptions } from 'electron';
import type { ShellLanguage } from '@cashfold/platform';
import { APP_NAME, RELEASE_PAGE_BASE, SOURCE_REPO_URL } from './identity';
import { labelsFor } from './menu-labels';

/** The standard application menu. Edit matters most: without it, copy and paste do not work on macOS. */
export function buildMenu(deps: { readonly menu: Pick<typeof Menu, 'buildFromTemplate'>; readonly isMac: boolean; readonly isDev: boolean; readonly openExternal: (url: string) => Promise<void>; readonly language?: ShellLanguage }): Menu {
  const labels = labelsFor(deps.language ?? 'en');
  const open = (url: string) => () => void deps.openExternal(url);
  const template: MenuItemConstructorOptions[] = [
    ...(deps.isMac
      ? ([{ label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] as MenuItemConstructorOptions[])
      : ([{ label: labels.file, submenu: [{ role: 'quit' }] }] as MenuItemConstructorOptions[])),
    { label: labels.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: labels.view,
      submenu: [
        ...(deps.isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[]) : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: labels.window, submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(deps.isMac ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[]) : ([{ role: 'close' }] as MenuItemConstructorOptions[]))] },
    {
      role: 'help',
      submenu: [
        { label: labels.onGitHub(APP_NAME), click: open(SOURCE_REPO_URL) },
        { label: labels.releaseNotes, click: open(RELEASE_PAGE_BASE) },
        { label: labels.reportProblem, click: open(`${SOURCE_REPO_URL}/issues`) },
      ],
    },
  ];
  return deps.menu.buildFromTemplate(template);
}
