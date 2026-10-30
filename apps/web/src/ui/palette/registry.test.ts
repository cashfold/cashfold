import { describe, expect, it, vi } from 'vitest';
import { createRegistry, type Command, type PaletteContext } from './registry';

const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({
  navigate: vi.fn(), openAdd: vi.fn(), lock: vi.fn(), toggleTheme: vi.fn(), openSignOut: vi.fn(), openHelp: vi.fn(), accounts: 1, foldId: 'f1', ...over,
});
const command = (id: string, over: Partial<Command> = {}): Command => ({ id, titleKey: `t.${id}`, group: 'action', run: vi.fn(), ...over });

describe('the command registry', () => {
  it('lists commands in the order they were registered', () => {
    const r = createRegistry();
    r.register([command('a'), command('b')]);
    r.register([command('c')]);
    expect(r.list(ctx()).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes exactly what one registration added', () => {
    const r = createRegistry();
    r.register([command('a')]);
    const remove = r.register([command('b'), command('c')]);
    remove();
    expect(r.list(ctx()).map((c) => c.id)).toEqual(['a']);
    remove();
    expect(r.list(ctx()).map((c) => c.id)).toEqual(['a']);
  });

  it('refuses a command whose id is already taken, and keeps the first', () => {
    const r = createRegistry();
    const first = command('a');
    r.register([first]);
    expect(() => r.register([command('a')])).toThrow(/already has a command "a"/);
    expect(r.list(ctx())).toEqual([first]);
  });

  it('ignores a duplicate quietly in production', () => {
    const r = createRegistry();
    r.register([command('a')]);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => r.register([command('a')])).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(r.list(ctx())).toHaveLength(1);
  });

  it('offers only the commands that are enabled now', () => {
    const r = createRegistry();
    r.register([command('always'), command('needs-account', { enabled: (c) => c.accounts > 0 })]);
    expect(r.list(ctx({ accounts: 0 })).map((c) => c.id)).toEqual(['always']);
    expect(r.list(ctx({ accounts: 2 })).map((c) => c.id)).toEqual(['always', 'needs-account']);
  });
});
