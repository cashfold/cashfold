import type { DesktopSettings, SettingsUpdate } from '@cashfold/platform';

// The preferences the person controls in Settings → Desktop, kept in the shell's state file beside the window bounds. Whatever is read back is
// untrusted (the file can be edited), so each field is checked on its own and a bad one falls back to its default without touching the rest.

export type { DesktopSettings };

const THEMES = ['system', 'light', 'dark'] as const;
const CLOSE_BEHAVIOURS = ['quit', 'background'] as const;

/** Closing the window keeps the app running on macOS, as people expect there, and quits on Windows and Linux. */
export function defaultSettings(platform: NodeJS.Platform): DesktopSettings {
  return { hideOnBlur: false, startAtLogin: false, closeBehavior: platform === 'darwin' ? 'background' : 'quit', theme: 'system' };
}

export function sanitiseSettings(raw: unknown, platform: NodeJS.Platform): DesktopSettings {
  const input = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defaults = defaultSettings(platform);
  const closeBehavior = input['closeBehavior'];
  const theme = input['theme'];
  return {
    hideOnBlur: typeof input['hideOnBlur'] === 'boolean' ? input['hideOnBlur'] : defaults.hideOnBlur,
    startAtLogin: typeof input['startAtLogin'] === 'boolean' ? input['startAtLogin'] : defaults.startAtLogin,
    closeBehavior: CLOSE_BEHAVIOURS.find((value) => value === closeBehavior) ?? defaults.closeBehavior,
    theme: THEMES.find((value) => value === theme) ?? defaults.theme,
  };
}

/** What a requested change becomes: staying in the background is only possible where there is a tray or menu-bar item to bring the app back from. */
export function applySettingsUpdate(current: DesktopSettings, update: SettingsUpdate, statusItem: boolean): DesktopSettings {
  const next: DesktopSettings = {
    ...current,
    ...(update.hideOnBlur === undefined ? {} : { hideOnBlur: update.hideOnBlur }),
    ...(update.startAtLogin === undefined ? {} : { startAtLogin: update.startAtLogin }),
    ...(update.closeBehavior === undefined ? {} : { closeBehavior: update.closeBehavior }),
  };
  return !statusItem && next.closeBehavior === 'background' ? { ...next, closeBehavior: 'quit' } : next;
}
