import { describe, expect, it, vi } from 'vitest';
import { mirrorPrimaryIcon } from './mirror-icon';

// The icon follows the primary colour (spec 014, US2): tab icon, touch icon, manifest and address-bar colour in the page, the dock and window in the desktop app.

function page(): Document {
  document.head.innerHTML = `
    <link rel="icon" href="/favicon.ico" sizes="48x48">
    <link rel="icon" href="/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="theme-color" content="#047857" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#10b981" media="(prefers-color-scheme: dark)">`;
  return document;
}
const hrefs = (doc: Document) => [...doc.querySelectorAll('link')].map((l) => l.getAttribute('href'));
const fn = () => undefined;
const desktopHost = () => ({
  cashfoldDesktop: {
    about: fn,
    revealDataFolder: fn,
    updates: Object.fromEntries(['state', 'check', 'download', 'install', 'openReleasePage', 'autoCheck', 'setAutoCheck', 'onChange'].map((key) => [key, fn])),
  },
});

describe('the icons in the page', () => {
  it('points the tab icons, the touch icon and the manifest at the files of the chosen colour', async () => {
    const doc = page();
    await mirrorPrimaryIcon('blue', doc, {});
    expect(hrefs(doc)).toEqual(['/icons/blue/favicon.ico', '/icons/blue/icon.svg', '/icons/blue/apple-touch-icon.png', '/manifests/blue.webmanifest']);
    const [light, dark] = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    expect([light?.content, dark?.content]).toEqual(['#1d4ed8', '#60a5fa']);
  });

  it('goes back to the original files for the default colour', async () => {
    const doc = page();
    await mirrorPrimaryIcon('pink', doc, {});
    await mirrorPrimaryIcon('emerald', doc, {});
    expect(hrefs(doc)).toEqual(['/favicon.ico', '/icon.svg', '/apple-touch-icon.png', '/manifest.webmanifest']);
    expect([...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)).toEqual(['#047857', '#10b981']);
  });

  it('does nothing, without error, in a page with no icon links', async () => {
    document.head.innerHTML = '';
    await expect(mirrorPrimaryIcon('teal', document, {})).resolves.toBeUndefined();
  });
});

describe('the icon in the desktop app', () => {
  it('sends the colour to the bridge in the desktop app, every time it changes', async () => {
    const setPrimaryColor = vi.fn<(c: string) => Promise<undefined>>(async () => undefined);
    for (const id of ['violet', 'amber']) await mirrorPrimaryIcon(id as never, page(), desktopHost(), async () => ({ setPrimaryColor }) as never);
    expect(setPrimaryColor.mock.calls.map(([c]) => c)).toEqual(['violet', 'amber']);
  });

  it('never loads or calls the bridge in a browser', async () => {
    const load = vi.fn(async () => undefined);
    await mirrorPrimaryIcon('violet', page(), {}, load as never);
    expect(load).not.toHaveBeenCalled();
  });

  it('is not an error when the shell cannot be reached', async () => {
    await expect(mirrorPrimaryIcon('violet', page(), desktopHost(), async () => { throw new Error('gone'); })).resolves.toBeUndefined();
  });
});
