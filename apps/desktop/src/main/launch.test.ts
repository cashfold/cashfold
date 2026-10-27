import { describe, expect, it, vi } from 'vitest';
import { applyStartAtLogin, autostartEntry, autostartFile, HIDDEN_ARGUMENT, startedAtLogin, type LaunchDeps } from './launch';

function deps(over: Partial<LaunchDeps> = {}) {
  const loginItems = { setLoginItemSettings: vi.fn(), getLoginItemSettings: vi.fn((): { openAtLogin: boolean; wasOpenedAtLogin?: boolean } => ({ openAtLogin: false })) };
  const files = { mkdir: vi.fn(), write: vi.fn(), remove: vi.fn() };
  const all: LaunchDeps = { platform: 'win32', loginItems, files, env: {}, execPath: '/opt/Cashfold/cashfold', homeDir: '/home/a', appName: 'Cashfold', ...over };
  return { all, loginItems, files };
}

describe('start at login on Windows and macOS', () => {
  it.each(['win32', 'darwin'] as const)('uses the login item with a hidden-start argument on %s', (platform) => {
    const { all, loginItems, files } = deps({ platform });
    expect(applyStartAtLogin(true, all)).toEqual({ applied: true });
    expect(loginItems.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, openAsHidden: true, args: [HIDDEN_ARGUMENT] });
    expect(files.write).not.toHaveBeenCalled();
  });

  it('removes the login item when switched off', () => {
    const { all, loginItems } = deps({ platform: 'darwin' });
    applyStartAtLogin(false, all);
    expect(loginItems.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, openAsHidden: false, args: [] });
  });

  it('reports a failure without throwing, so the stored choice can stay', () => {
    const { all, loginItems } = deps();
    loginItems.setLoginItemSettings.mockImplementation(() => {
      throw new Error('denied by policy');
    });
    expect(applyStartAtLogin(true, all)).toEqual({ applied: false });
  });
});

describe('start at login on Linux', () => {
  it('writes a standard autostart entry that starts the installed executable hidden', () => {
    const { all, files } = deps({ platform: 'linux' });
    expect(applyStartAtLogin(true, all)).toEqual({ applied: true });
    expect(files.mkdir).toHaveBeenCalledWith('/home/a/.config/autostart');
    const [path, content] = files.write.mock.calls[0]!;
    expect(path).toBe('/home/a/.config/autostart/cashfold.desktop');
    expect(content).toContain('[Desktop Entry]');
    expect(content).toContain('Type=Application');
    expect(content).toContain('Name=Cashfold');
    expect(content).toContain(`Exec="/opt/Cashfold/cashfold" ${HIDDEN_ARGUMENT}`);
  });

  it('points at the AppImage itself when run from one', () => {
    const { all, files } = deps({ platform: 'linux', env: { APPIMAGE: '/home/a/Apps/Cashfold-0.4.0.AppImage' } });
    applyStartAtLogin(true, all);
    expect(files.write.mock.calls[0]![1]).toContain('Exec="/home/a/Apps/Cashfold-0.4.0.AppImage" --hidden');
  });

  it('honours XDG_CONFIG_HOME', () => {
    expect(autostartFile({ env: { XDG_CONFIG_HOME: '/cfg' }, homeDir: '/home/a' })).toBe('/cfg/autostart/cashfold.desktop');
    expect(autostartFile({ env: { XDG_CONFIG_HOME: '' }, homeDir: '/home/a' })).toBe('/home/a/.config/autostart/cashfold.desktop');
  });

  it('quotes a path with spaces and special characters', () => {
    const entry = autostartEntry({ env: { APPIMAGE: '/home/a/My Apps/Cash"fold$.AppImage' }, execPath: 'x', appName: 'Cashfold' });
    expect(entry).toContain('Exec="/home/a/My Apps/Cash\\"fold\\$.AppImage" --hidden');
  });

  it('removes the entry when switched off', () => {
    const { all, files } = deps({ platform: 'linux' });
    applyStartAtLogin(false, all);
    expect(files.remove).toHaveBeenCalledWith('/home/a/.config/autostart/cashfold.desktop');
    expect(files.write).not.toHaveBeenCalled();
  });

  it('reports a failure (a read-only folder) without throwing', () => {
    const { all, files } = deps({ platform: 'linux' });
    files.write.mockImplementation(() => {
      throw new Error('EROFS');
    });
    expect(applyStartAtLogin(true, all)).toEqual({ applied: false });
  });
});

describe('a start made at login', () => {
  it('is known by the hidden argument on every system', () => {
    const { all } = deps();
    expect(startedAtLogin(['cashfold', HIDDEN_ARGUMENT], all)).toBe(true);
    expect(startedAtLogin(['cashfold'], all)).toBe(false);
  });

  it('is known on macOS by the system saying the app was opened at login, and a window is then created hidden', () => {
    const { all, loginItems } = deps({ platform: 'darwin' });
    loginItems.getLoginItemSettings.mockReturnValue({ openAtLogin: true, wasOpenedAtLogin: true });
    expect(startedAtLogin(['cashfold'], all)).toBe(true);
    loginItems.getLoginItemSettings.mockReturnValue({ openAtLogin: true, wasOpenedAtLogin: false });
    expect(startedAtLogin(['cashfold'], all)).toBe(false);
  });
});
