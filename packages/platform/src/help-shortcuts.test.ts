import { describe, expect, it } from 'vitest';
import { ACTION_IDS } from './schemas';
import { HELP_SHORTCUTS } from './help-shortcuts';

// The Help dialog's list (spec 008). Its agreement with what the desktop shell really handles is tested in apps/desktop (help-shortcuts.test.ts).

const APP_ACTIONS = ACTION_IDS.filter((id) => id === 'new-transaction' || id === 'lock' || id === 'settings' || id === 'search' || id === 'import' || id === 'export' || id.startsWith('go:'));

describe('the help shortcut list', () => {
  it('has unique ids and only the two groups', () => {
    const ids = HELP_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP_SHORTCUTS) expect(['app', 'standard']).toContain(s.group);
  });

  it('lists every app action that has a shortcut exactly once, and nothing else in the app group', () => {
    const listed = HELP_SHORTCUTS.filter((s) => s.group === 'app').map((s) => s.action);
    expect([...listed].sort()).toEqual([...APP_ACTIONS].sort());
  });

  it('lists the standard shortcuts of the spec', () => {
    const standard = HELP_SHORTCUTS.filter((s) => s.group === 'standard').map((s) => s.action);
    expect([...standard].sort()).toEqual(['close', 'copy', 'cut', 'minimize', 'paste', 'quit', 'redo', 'select-all', 'toggle-fullscreen', 'undo', 'zoom-in', 'zoom-out', 'zoom-reset']);
  });

  it('marks only Lock as working while locked', () => {
    expect(HELP_SHORTCUTS.filter((s) => s.worksWhenLocked).map((s) => s.action)).toEqual(['lock']);
  });

  it('never lists a development-only shortcut', () => {
    for (const s of HELP_SHORTCUTS) expect(['reload', 'toggle-devtools']).not.toContain(s.action);
  });

  it('gives every entry a key on both kinds of system', () => {
    for (const s of HELP_SHORTCUTS) {
      expect(s.keys.mac.key.length, s.id).toBeGreaterThan(0);
      expect(s.keys.other.key.length, s.id).toBeGreaterThan(0);
    }
  });
});
