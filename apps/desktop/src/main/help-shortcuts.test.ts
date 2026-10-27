import { HELP_SHORTCUTS, type HelpKeys, type HelpSystem } from '@cashfold/platform';
import { describe, expect, it } from 'vitest';
import { matchShortcut, SHORTCUTS, type ShortcutEntry, type ShortcutInput } from './shortcuts';

// Spec 008: the Help dialog lists what the shell really handles. If a shortcut is added, removed or rebound here without the list in
// packages/platform/src/help-shortcuts.ts, one of these fails and names it.

const PLATFORMS = ['darwin', 'win32', 'linux'] as const;
type Platform = (typeof PLATFORMS)[number];
const systemOf = (platform: Platform): HelpSystem => (platform === 'darwin' ? 'mac' : 'other');

/** The key press the list describes, the way the system delivers it to the window. */
function pressOf(keys: HelpKeys, platform: Platform): ShortcutInput {
  const mac = platform === 'darwin';
  const has = (m: string) => keys.modifiers.includes(m as never);
  return {
    key: keys.key.toLowerCase(),
    control: has('ctrl') || (has('primary') && !mac),
    meta: has('primary') && mac,
    shift: has('shift'),
    alt: has('alt'),
  };
}

/** A key press for one of the keys a table entry owns. */
function pressOfEntry(entry: ShortcutEntry, key: string, platform: Platform): ShortcutInput {
  const mac = platform === 'darwin';
  return {
    key,
    control: entry.modifier === 'both' || (entry.modifier === 'primary' && !mac),
    meta: entry.modifier === 'both' || (entry.modifier === 'primary' && mac),
    shift: entry.shift === true,
    alt: false,
  };
}

const appliesOn = (entry: ShortcutEntry, platform: Platform): boolean => entry.platforms === 'all' || (entry.platforms === 'mac') === (platform === 'darwin');

/**
 * Presses the system handles itself, so the shell's table has no entry for them: Command+Q belongs to the macOS application menu, and on Windows and
 * Linux the text field does undo, redo and the clipboard (so does Chromium for select all). The list may say `system` only for these.
 */
const SYSTEM_HANDLED: Readonly<Record<HelpSystem, readonly string[]>> = {
  mac: ['quit'],
  other: ['undo', 'redo', 'cut', 'copy', 'paste', 'select-all'],
};

describe.each(PLATFORMS)('the help list against the shell on %s', (platform) => {
  const system = systemOf(platform);

  it('is handled by the shell as listed: every shell entry in the list does what it says, on the keys it shows', () => {
    for (const item of HELP_SHORTCUTS.filter((s) => s.via[system] === 'shell')) {
      const entry = matchShortcut(pressOf(item.keys[system], platform), platform);
      expect(entry?.action, `${item.id} (${item.keys[system].modifiers.join('+')}+${item.keys[system].key}) on ${platform}`).toBe(item.action);
      // The lock rule: only Lock reaches the person's data without being ignored while locked.
      if (item.group === 'app') expect(entry?.data === true, `${item.id} locked behaviour on ${platform}`).toBe(!item.worksWhenLocked);
    }
  });

  it('lists everything the shell handles: every key of every shell entry returns that entry, and some list entry has its action', () => {
    for (const entry of SHORTCUTS.filter((e) => e.development !== true && appliesOn(e, platform))) {
      for (const key of entry.keys) {
        expect(matchShortcut(pressOfEntry(entry, key, platform), platform)?.action, `${entry.action} on key ${key} on ${platform}`).toBe(entry.action);
      }
      const item = HELP_SHORTCUTS.find((s) => s.action === entry.action);
      expect(item, `the shell handles ${entry.action} on ${platform} but the help list does not show it`).toBeDefined();
      expect(item?.via[system], `${entry.action} on ${platform} is handled by the shell but the list says the system does`).toBe('shell');
    }
  });

  it('says the system handles a press only where it really does', () => {
    const system_handled = HELP_SHORTCUTS.filter((s) => s.via[system] === 'system').map((s) => s.action).sort();
    expect(system_handled).toEqual([...SYSTEM_HANDLED[system]].sort());
    // …and the shell has no entry of its own for those presses, or the list would be hiding what the shell does.
    for (const item of HELP_SHORTCUTS.filter((s) => s.via[system] === 'system')) {
      expect(matchShortcut(pressOf(item.keys[system], platform), platform)?.action, `${item.id} on ${platform}`).toBeUndefined();
    }
  });

  it('never lists a shortcut that only exists in an unpackaged run', () => {
    const development = SHORTCUTS.filter((e) => e.development === true).map((e) => e.action);
    for (const item of HELP_SHORTCUTS) expect(development, item.id).not.toContain(item.action);
    // In a packaged run those presses are not the shell's.
    for (const entry of SHORTCUTS.filter((e) => e.development === true && appliesOn(e, platform))) {
      for (const key of entry.keys) expect(matchShortcut(pressOfEntry(entry, key, platform), platform, false)).toBeUndefined();
    }
  });
});
