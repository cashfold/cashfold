import { describe, expect, it, vi } from 'vitest';
import { ENGLISH } from '../i18n/i18n';
import { ROUTES, PRIMARY_SECTIONS, SETTINGS_GROUPS } from '../shell/routes';
import { ACTION_COMMANDS } from './actions';
import { SCREEN_COMMANDS } from './builtin-commands';
import { registry, type PaletteContext } from './registry';

const ctx = (over: Partial<PaletteContext> = {}) => {
  const calls: string[] = [];
  const context: PaletteContext = {
    navigate: vi.fn((href: string) => void calls.push(`go ${href}`)),
    openAdd: vi.fn(() => void calls.push('add')),
    lock: vi.fn(() => void calls.push('lock')),
    toggleTheme: vi.fn(() => void calls.push('theme')),
    openSignOut: vi.fn(() => void calls.push('signout')),
    openHelp: vi.fn(() => void calls.push('help')),
    privacy: false,
    togglePrivacy: vi.fn(() => void calls.push('privacy')),
    accounts: 1,
    foldId: 'f1',
    ...over,
  };
  return { context, calls };
};
const find = (id: string) => [...SCREEN_COMMANDS, ...ACTION_COMMANDS].find((c) => c.id === id)!;

describe('the built-in screens', () => {
  it('open the routes of the route table, so a renamed route cannot drift', () => {
    for (const section of PRIMARY_SECTIONS) {
      const { context, calls } = ctx();
      find(`go-${section.id}`).run(context);
      expect(calls).toEqual([`go ${section.href}`]);
    }
    const sync = SETTINGS_GROUPS.find((g) => g.id === 'sync')!;
    const { context, calls } = ctx();
    find('go-devices').run(context);
    find('go-schedules').run(context);
    expect(calls).toEqual([`go ${sync.href}`, 'go /plan/?view=schedules']);
  });

  it('only open screens that exist', () => {
    for (const command of SCREEN_COMMANDS) {
      const { context, calls } = ctx();
      command.run(context);
      const href = calls[0]!.replace('go ', '').split('?')[0]!;
      expect(ROUTES.has(href), `${command.id} -> ${href}`).toBe(true);
    }
  });
});

describe('the built-in actions', () => {
  it.each([
    ['add-transaction', 'add'],
    ['lock-now', 'lock'],
    ['switch-theme', 'theme'],
    ['sign-out', 'signout'],
    ['help', 'help'],
  ])('%s calls exactly the matching context function once, and nothing else', (id, expected) => {
    const { context, calls } = ctx();
    find(id).run(context);
    expect(calls).toEqual([expected]);
  });

  it('offers Turn privacy mode on only while it is off and Turn it off only while it is on, each flipping it once and nothing else (spec 016)', () => {
    const off = ctx({ privacy: false });
    expect(find('privacy-on').enabled!(off.context)).toBe(true);
    expect(find('privacy-off').enabled!(off.context)).toBe(false);
    find('privacy-on').run(off.context);
    expect(off.calls).toEqual(['privacy']);
    const on = ctx({ privacy: true });
    expect(find('privacy-on').enabled!(on.context)).toBe(false);
    expect(find('privacy-off').enabled!(on.context)).toBe(true);
    find('privacy-off').run(on.context);
    expect(on.calls).toEqual(['privacy']);
    expect(on.context.lock).not.toHaveBeenCalled();
  });

  it('only opens the sign-out dialog; the dialog asks for its own confirmation, so the palette never signs out by itself', () => {
    const { context } = ctx();
    find('sign-out').run(context);
    expect(context.openSignOut).toHaveBeenCalledTimes(1);
    expect(context.lock).not.toHaveBeenCalled();
    expect(context.navigate).not.toHaveBeenCalled();
  });

  it('does not offer Add transaction without an account', () => {
    expect(find('add-transaction').enabled!(ctx({ accounts: 0 }).context)).toBe(false);
    expect(find('add-transaction').enabled!(ctx({ accounts: 1 }).context)).toBe(true);
  });
});

describe('the registry the palette reads', () => {
  it('has every built-in command once, with unique ids', () => {
    const ids = registry.list(ctx().context).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of [...SCREEN_COMMANDS, ...ACTION_COMMANDS]) expect(ids.includes(command.id) || command.enabled?.(ctx().context) === false).toBe(true);
  });

  it('gives every command a title and keywords in the catalogue', () => {
    for (const command of [...SCREEN_COMMANDS, ...ACTION_COMMANDS]) {
      expect(ENGLISH[command.titleKey], `${command.id} title ${command.titleKey}`).toBeTruthy();
      for (const key of command.keywordKeys ?? []) expect(ENGLISH[key], `${command.id} keyword ${key}`).toBeTruthy();
    }
  });
});
