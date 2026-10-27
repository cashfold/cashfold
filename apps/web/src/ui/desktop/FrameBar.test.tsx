import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applyFrameState, hasOwnBar } from './frame-attributes';
import FrameBar from './FrameBar';

describe('which windows have the app\'s own bar', () => {
  it('are the macOS and Windows ones; Linux keeps the system title bar; a browser has none', () => {
    expect([hasOwnBar('darwin'), hasOwnBar('win32'), hasOwnBar('linux'), hasOwnBar(undefined), hasOwnBar('')]).toEqual([true, true, false, false, false]);
  });
});

describe('the frame bar', () => {
  it('renders nothing outside a desktop window on macOS or Windows (a browser, Linux, or before the page is on screen)', () => {
    expect(renderToStaticMarkup(<FrameBar />)).toBe('');
  });

  it('renders a drag bar, hidden from assistive technology, on macOS and Windows', () => {
    for (const platform of ['darwin', 'win32']) {
      vi.stubGlobal('document', { documentElement: { dataset: { platform } } });
      const html = renderToStaticMarkup(<FrameBar />);
      expect(html).toContain('class="frame-bar"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('data-testid="frame-bar"');
    }
    vi.stubGlobal('document', { documentElement: { dataset: { platform: 'linux' } } });
    expect(renderToStaticMarkup(<FrameBar />)).toBe('');
    vi.unstubAllGlobals();
  });
});

describe('the frame state on the page', () => {
  it('sets full screen, maximised and the translucent material as attributes for the CSS', () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    applyFrameState(root, { fullscreen: true, maximized: false, translucent: true });
    expect(root.dataset).toEqual({ fullscreen: 'true', maximized: 'false', translucent: 'true' });
    applyFrameState(root, { fullscreen: false, maximized: true, translucent: false });
    expect(root.dataset).toEqual({ fullscreen: 'false', maximized: 'true', translucent: 'false' });
  });
});

describe('the CSS of the frame', () => {
  // The layout is unchanged in a browser and on Linux because the bar height is zero there; and the bar is a drag region whose controls do not drag.
  it('is zero by default, 40 px with the bar, drags by the bar and not by its controls, and keeps the traffic lights clear', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/:root \{[^}]*--frame-bar-h:\s*0px/);
    expect(css).toMatch(/html\[data-frame="bar"\] \{ --frame-bar-h: 40px; \}/);
    expect(css).toMatch(/\.frame-bar \{[^}]*-webkit-app-region:\s*drag/);
    expect(css).toMatch(/\.frame-bar :is\([^)]*button[^)]*\) \{ -webkit-app-region:\s*no-drag/);
    expect(css).toMatch(/data-platform="darwin"\] \{ --frame-inset-start: 80px/);
    expect(css).toMatch(/data-fullscreen="true"\] \{ --frame-inset-start: 0px/);
    expect(css).toMatch(/titlebar-area-width/);
  });

  it('lets the sidebar be translucent only when the shell says the material is on', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/data-translucent="true"\] \.sidebar-layout \{ background-color: transparent/);
    // Only at the widths where the sidebar is shown: below them the page is opaque.
    expect(css).toMatch(/@media \(min-width: 64rem\) \{[^@]*data-translucent="true"\] \.sidebar-layout/);
  });
});
