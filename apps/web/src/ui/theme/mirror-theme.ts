import type { DesktopBridge } from '@cashfold/platform';
import { loadDesktop } from '../desktop/lazy';
import type { ThemeChoice } from './resolve-theme';

type LoadBridge = () => Promise<Pick<DesktopBridge, 'setTheme'> | undefined>;

const loadBridge: LoadBridge = async () => (await import('../../adapters/platform')).getDesktopBridge();

/**
 * In the desktop app, tells the shell the theme choice so the window opens in the right colours and the native chrome matches. The page stays the
 * source of truth: it sends its choice at start and on every change. Does nothing, and loads nothing, in a browser.
 */
export async function mirrorThemeToShell(choice: ThemeChoice, host: object = globalThis, load: LoadBridge = loadBridge): Promise<void> {
  try {
    const bridge = await loadDesktop(load, host);
    await bridge?.setTheme(choice);
  } catch {
    // The shell's colours are best effort; the page works without them.
  }
}
