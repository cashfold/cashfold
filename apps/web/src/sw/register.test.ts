import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';

// The desktop app serves its files from the app itself, so it has nothing to cache and no second update mechanism to fight the updater (R-D-06).

function install(bridge: unknown) {
  const register = vi.fn(async () => ({ addEventListener: vi.fn(), waiting: null, installing: null }));
  vi.stubGlobal('navigator', { serviceWorker: { register, controller: null } });
  if (bridge !== undefined) vi.stubGlobal('cashfoldDesktop', bridge);
  vi.stubEnv('NODE_ENV', 'production');
  return register;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('registering the offline worker', () => {
  it('registers in the web app, as before', async () => {
    const register = install(undefined);
    await registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });

  it('does not register in the desktop app', async () => {
    const noop = () => undefined;
    const bridge = { about: noop, revealDataFolder: noop, updates: { state: noop, check: noop, download: noop, install: noop, openReleasePage: noop, autoCheck: noop, setAutoCheck: noop, onChange: noop } };
    const register = install(bridge);
    await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it('still registers when something that is not the bridge sits under its name', async () => {
    const register = install({});
    await registerServiceWorker();
    expect(register).toHaveBeenCalledTimes(1);
  });
});
