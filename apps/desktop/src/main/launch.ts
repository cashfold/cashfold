import { join } from 'node:path';

// Starting when the person signs in to the computer (spec 006, US6). The app then starts without showing a window and, with no session yet, is
// locked by definition; it is visible in the tray or menu bar. Windows and macOS have an API for it; Linux has none, so a standard autostart entry
// is written (and removed again when the choice is turned off).

/** The argument a login start carries, so the app knows to keep its window hidden. */
export const HIDDEN_ARGUMENT = '--hidden';

export interface LoginItemApi {
  setLoginItemSettings(settings: { openAtLogin: boolean; openAsHidden?: boolean; args?: string[] }): void;
  getLoginItemSettings(): { openAtLogin: boolean; wasOpenedAtLogin?: boolean };
}

export interface LaunchDeps {
  readonly platform: NodeJS.Platform;
  readonly loginItems: LoginItemApi;
  readonly files: {
    mkdir(path: string): void;
    write(path: string, content: string): void;
    remove(path: string): void;
  };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  readonly homeDir: string;
  readonly appName: string;
}

/** Where the Linux autostart entry lives (XDG: `$XDG_CONFIG_HOME/autostart`, else `~/.config/autostart`). */
export function autostartFile(deps: Pick<LaunchDeps, 'env' | 'homeDir'>): string {
  const base = deps.env['XDG_CONFIG_HOME'] !== undefined && deps.env['XDG_CONFIG_HOME'] !== '' ? deps.env['XDG_CONFIG_HOME'] : join(deps.homeDir, '.config');
  return join(base, 'autostart', 'cashfold.desktop');
}

/** A path as the `Exec` key of a desktop entry wants it: in double quotes, with `"`, `` ` ``, `$` and `\` escaped. */
const quoteExec = (path: string): string => `"${path.replace(/(["`$\\])/g, '\\$1')}"`;

/** The program the entry starts: the AppImage itself when run from one (its path changes with every download), else the installed executable. */
export const autostartTarget = (deps: Pick<LaunchDeps, 'env' | 'execPath'>): string => (deps.env['APPIMAGE'] !== undefined && deps.env['APPIMAGE'] !== '' ? deps.env['APPIMAGE'] : deps.execPath);

export function autostartEntry(deps: Pick<LaunchDeps, 'env' | 'execPath' | 'appName'>): string {
  return ['[Desktop Entry]', 'Type=Application', `Name=${deps.appName}`, `Exec=${quoteExec(autostartTarget(deps))} ${HIDDEN_ARGUMENT}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}

/**
 * Turns start at login on or off. Returns whether it could be applied; the person's choice is kept either way, and Settings shows the result
 * (a read-only autostart folder, or a policy, can stop it).
 */
export function applyStartAtLogin(on: boolean, deps: LaunchDeps): { applied: boolean } {
  try {
    if (deps.platform === 'linux') {
      const file = autostartFile(deps);
      if (on) {
        deps.files.mkdir(join(file, '..'));
        deps.files.write(file, autostartEntry(deps));
      } else {
        deps.files.remove(file);
      }
      return { applied: true };
    }
    deps.loginItems.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: on ? [HIDDEN_ARGUMENT] : [] });
    return { applied: true };
  } catch {
    return { applied: false };
  }
}

/** Whether this start was made by the login item, so no window should open over the person's work. */
export function startedAtLogin(argv: readonly string[], deps: Pick<LaunchDeps, 'platform' | 'loginItems'>): boolean {
  if (argv.includes(HIDDEN_ARGUMENT)) return true;
  if (deps.platform === 'darwin') {
    try {
      return deps.loginItems.getLoginItemSettings().wasOpenedAtLogin === true;
    } catch {
      return false;
    }
  }
  return false;
}
