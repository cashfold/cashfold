import type { DesktopBridge } from '@cashfold/platform';
import { loadDesktop } from '../desktop/lazy';
import { colorOf, DEFAULT_PRIMARY, type PrimaryChoice } from './palette';

type LoadBridge = () => Promise<Pick<DesktopBridge, 'setPrimaryColor'> | undefined>;

const loadBridge: LoadBridge = async () => (await import('../../adapters/platform')).getDesktopBridge();

/**
 * Makes the app's icon follow the primary colour (spec 014): the browser tab icon, the touch icon, the manifest an install reads, the browser's
 * address-bar colour, and in the desktop app the dock and window icon through the bridge. The files are the ones `pnpm gen:assets` makes for each
 * palette colour. The default colour uses the original files, so a person who never chooses sees nothing change. An app that is already installed
 * keeps the icon it was installed with; the system decides that. Best effort: a page without an icon link or a shell that cannot be reached is fine.
 */
export async function mirrorPrimaryIcon(primary: PrimaryChoice, doc: Document = document, host: object = globalThis, load: LoadBridge = loadBridge): Promise<void> {
  try {
    const base = primary === DEFAULT_PRIMARY ? '' : `/icons/${primary}`;
    const file = (name: string): string => (base === '' ? `/${name}` : `${base}/${name}`);
    for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
      const href = link.getAttribute('href') ?? '';
      const name = link.rel === 'apple-touch-icon' ? 'apple-touch-icon.png' : /\.ico(\?|$)/.test(href) ? 'favicon.ico' : /\.svg(\?|$)/.test(href) ? 'icon.svg' : undefined;
      if (name !== undefined) link.setAttribute('href', file(name));
    }
    doc.querySelector('link[rel="manifest"]')?.setAttribute('href', primary === DEFAULT_PRIMARY ? '/manifest.webmanifest' : `/manifests/${primary}.webmanifest`);
    const color = colorOf(primary);
    for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = (meta.media.includes('dark') ? color.dark : color.light).primary;
    }
  } catch {
    // The page icon is cosmetic.
  }
  try {
    const bridge = await loadDesktop(load, host);
    await bridge?.setPrimaryColor(primary);
  } catch {
    // The shell's icon is best effort; the page works without it.
  }
}
