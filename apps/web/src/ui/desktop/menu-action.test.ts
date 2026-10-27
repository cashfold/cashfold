import { describe, expect, it, vi } from 'vitest';
import { ACTION_IDS } from '@cashfold/platform';
import { performMenuAction, type MenuActionDeps } from './menu-action';

const deps = (unlocked: boolean) => {
  const calls: string[] = [];
  const d: MenuActionDeps = {
    unlocked,
    openAdd: vi.fn(() => void calls.push('add')),
    lock: vi.fn(() => void calls.push('lock')),
    navigate: vi.fn((href: string) => void calls.push(`go ${href}`)),
    focus: vi.fn((target: string) => void calls.push(`focus ${target}`)),
    openFold: vi.fn((index: number) => void calls.push(`fold ${index}`)),
  };
  return { d, calls };
};

describe('what a menu action does in the page', () => {
  it.each([
    ['new-transaction', ['add']],
    ['lock', ['lock']],
    ['settings', ['go /settings/']],
    ['search', ['focus transactions-search', 'go /transactions/']],
    ['go:overview', ['go /overview/']],
    ['go:transactions', ['go /transactions/']],
    ['go:accounts', ['go /accounts/']],
    ['go:plan', ['go /plan/']],
    ['go:settings', ['go /settings/']],
    ['import', ['focus data-import', 'go /settings/data/']],
    ['export', ['focus data-export', 'go /settings/data/']],
    ['open-fold:0', ['fold 0']],
    ['open-fold:4', ['fold 4']],
  ])('%s while unlocked', (action, expected) => {
    const { d, calls } = deps(true);
    performMenuAction(action, d);
    expect(calls).toEqual(expected);
  });

  it('does nothing but lock while locked', () => {
    for (const action of ACTION_IDS) {
      const { d, calls } = deps(false);
      performMenuAction(action, d);
      expect(calls, action).toEqual(action === 'lock' ? ['lock'] : []);
    }
  });

  it('ignores an id that is not in the set', () => {
    const { d, calls } = deps(true);
    for (const action of ['', 'go:../etc', 'delete-everything', 'open-fold:9']) performMenuAction(action, d);
    expect(calls).toEqual([]);
  });

  it('leaves the shell-side ids (show, quit) alone', () => {
    const { d, calls } = deps(true);
    performMenuAction('show', d);
    performMenuAction('quit', d);
    expect(calls).toEqual([]);
  });
});
