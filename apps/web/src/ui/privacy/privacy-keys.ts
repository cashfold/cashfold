import type { KeyLike } from '../palette/palette-keys';

// The key that turns Privacy mode on and off in a browser: Command+Shift+M on an Apple system, Control+Shift+M elsewhere (spec 016, research R10). In the
// desktop app the shell has its own table entry and sends the page an action instead. Like the palette's key it ignores a press someone else already
// handled and one made while composing text, and it never matches with Alt.

export function isPrivacyKey(event: KeyLike, apple: boolean): boolean {
  if (event.defaultPrevented || event.isComposing === true) return false;
  if (event.key.toLowerCase() !== 'm' || !event.shiftKey || event.altKey) return false;
  return apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
