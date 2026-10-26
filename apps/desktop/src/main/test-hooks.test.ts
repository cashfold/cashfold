import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete (globalThis as { __cashfoldTest?: unknown }).__cashfoldTest;
});

describe('test hooks', () => {
  it('are absent when the build constant is undefined, as in any run that was not built for the tests', async () => {
    const { exposeTestHook } = await import('./test-hooks');
    exposeTestHook('badge', () => 3);
    expect((globalThis as { __cashfoldTest?: unknown }).__cashfoldTest).toBeUndefined();
  });

  it('are absent when the build constant is false', async () => {
    vi.stubGlobal('__CASHFOLD_TEST_HOOKS__', false);
    const { exposeTestHook } = await import('./test-hooks');
    exposeTestHook('badge', () => 3);
    expect((globalThis as { __cashfoldTest?: unknown }).__cashfoldTest).toBeUndefined();
  });

  it('are registered by name when the build constant is true', async () => {
    vi.stubGlobal('__CASHFOLD_TEST_HOOKS__', true);
    const { exposeTestHook } = await import('./test-hooks');
    exposeTestHook('badge', () => 3);
    const hooks = (globalThis as unknown as { __cashfoldTest: Record<string, () => number> }).__cashfoldTest;
    expect(Object.keys(hooks)).toEqual(['badge']);
    expect(hooks['badge']!()).toBe(3);
  });

  it('are not switched on by a runtime variable', async () => {
    vi.stubEnv('CASHFOLD_TEST_BUILD', '1');
    const { exposeTestHook } = await import('./test-hooks');
    exposeTestHook('badge', () => 3);
    expect((globalThis as { __cashfoldTest?: unknown }).__cashfoldTest).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
