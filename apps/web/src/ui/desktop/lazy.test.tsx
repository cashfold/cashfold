import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesktopOnly, loadDesktop } from './lazy';

const bridge = { about: () => undefined, revealDataFolder: () => undefined, updates: Object.fromEntries(['state', 'check', 'download', 'install', 'openReleasePage', 'autoCheck', 'setAutoCheck', 'onChange'].map((name) => [name, () => undefined])) };

describe('loading desktop-only code', () => {
  it('imports nothing in a browser', async () => {
    const load = vi.fn(async () => 'module');
    await expect(loadDesktop(load, {})).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('imports the module in the desktop app', async () => {
    const load = vi.fn(async () => 'module');
    await expect(loadDesktop(load, { cashfoldDesktop: bridge })).resolves.toBe('module');
    expect(load).toHaveBeenCalledOnce();
  });

  it('renders nothing before the module has loaded, so server and browser output agree', () => {
    const load = vi.fn(async () => ({ default: () => <p>desktop</p> }));
    expect(renderToStaticMarkup(<DesktopOnly load={load} />)).toBe('');
    expect(load).not.toHaveBeenCalled();
  });
});
