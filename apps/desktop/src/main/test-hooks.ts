import { TEST_HOOKS_ENABLED } from './build';

// What the packaged-app tests can reach in the shell, and only in a build made for them. Each module that has something worth reading or
// triggering registers it here by name (a power event to emit, the badge, the menu models, the window options, the queued intake items, a
// launch argument vector to deliver). In a release the constant is false, the minifier removes the function below, and no trace is left.

type Hook = (...args: never[]) => unknown;

/** Registers a hook on `globalThis.__cashfoldTest` (reachable from Playwright's `app.evaluate`); does nothing outside a test build. */
export const exposeTestHook: (name: string, hook: Hook) => void = TEST_HOOKS_ENABLED
  ? (name, hook) => {
      const target = globalThis as { __cashfoldTest?: Record<string, Hook> };
      (target.__cashfoldTest ??= {})[name] = hook;
    }
  : () => undefined;
