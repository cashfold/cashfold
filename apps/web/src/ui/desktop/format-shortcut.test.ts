import { describe, expect, it } from 'vitest';
import { HELP_SHORTCUTS, type HelpKeys } from '@cashfold/platform';
import { formatShortcut } from './format-shortcut';

const keys = (id: string, system: 'mac' | 'other'): HelpKeys => HELP_SHORTCUTS.find((s) => s.id === id)!.keys[system];

describe('how a shortcut is written', () => {
  it('uses the macOS symbols, in the system order, with no separators', () => {
    expect(formatShortcut(keys('new-transaction', 'mac'), 'darwin').text).toBe('⌘N');
    expect(formatShortcut(keys('import', 'mac'), 'darwin').text).toBe('⇧⌘I');
    expect(formatShortcut(keys('fullscreen', 'mac'), 'darwin').text).toBe('⌃⌘F');
    expect(formatShortcut(keys('settings', 'mac'), 'darwin').text).toBe('⌘,');
    expect(formatShortcut(keys('zoom-reset', 'mac'), 'darwin').text).toBe('⌘0');
  });

  it('uses words joined by plus signs on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(formatShortcut(keys('new-transaction', 'other'), platform).text).toBe('Ctrl+N');
      expect(formatShortcut(keys('import', 'other'), platform).text).toBe('Ctrl+Shift+I');
      expect(formatShortcut(keys('fullscreen', 'other'), platform).text).toBe('F11');
      expect(formatShortcut(keys('settings', 'other'), platform).text).toBe('Ctrl+,');
      expect(formatShortcut(keys('redo', 'other'), platform).text).toBe('Ctrl+Shift+Z');
    }
  });

  it('spells the keys out for a screen reader', () => {
    expect(formatShortcut(keys('new-transaction', 'mac'), 'darwin').spoken).toBe('Command, N');
    expect(formatShortcut(keys('import', 'mac'), 'darwin').spoken).toBe('Shift, Command, I');
    expect(formatShortcut(keys('fullscreen', 'mac'), 'darwin').spoken).toBe('Control, Command, F');
    expect(formatShortcut(keys('import', 'other'), 'win32').spoken).toBe('Control, Shift, I');
    expect(formatShortcut(keys('fullscreen', 'other'), 'linux').spoken).toBe('F11');
    expect(formatShortcut(keys('settings', 'other'), 'linux').spoken).toBe('Control, comma');
  });
});
