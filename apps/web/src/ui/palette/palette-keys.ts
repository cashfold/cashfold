import { formatShortcut } from '../desktop/format-shortcut';
import type { DesktopPlatform } from '../desktop/desktop-store';

// The key that opens the palette in a browser (the desktop shell has its own entry in its shortcut table and sends the page an action instead) and the
// checks that decide whether it may open (spec 015, FR-001, FR-019, FR-022).

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing?: boolean;
}

/** Whether this browser is on an Apple system, where Command is the primary key. */
export function isApplePlatform(nav: { platform?: string; userAgentData?: { platform?: string } } = typeof navigator === 'undefined' ? {} : navigator): boolean {
  const name = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(name);
}

/** Command+K on an Apple system, Control+K elsewhere; no Shift, no Alt, not already handled, not in the middle of composing text. */
export function isPaletteKey(event: KeyLike, apple: boolean): boolean {
  if (event.defaultPrevented || event.isComposing === true) return false;
  if (event.key.toLowerCase() !== 'k' || event.shiftKey || event.altKey) return false;
  return apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The shortcut as the person's system writes it, for the placeholder. */
export function paletteShortcutText(apple: boolean): string {
  const platform: DesktopPlatform = apple ? 'darwin' : 'linux';
  return formatShortcut({ modifiers: ['primary'], key: 'K' }, platform).text;
}

/** Whether some other modal dialog is open, so the palette must not open over it (an answer owed, a form being filled). */
export function otherDialogOpen(doc: Pick<Document, 'querySelectorAll'>): boolean {
  return doc.querySelectorAll('[role="dialog"]:not([data-palette])').length > 0;
}
