// Copying a secret to the clipboard and clearing it again. Apart from the kit so that the screens that copy do not carry the QR generator.

type ClipboardLike = { writeText(text: string): Promise<void> };
let latestCopy = 0;

/**
 * Copies on an explicit user action, then overwrites the clipboard after `delayMs` unless something newer was copied here.
 * Returns false (never throws) when the clipboard is unavailable or denied.
 */
export async function copyWithAutoClear(text: string, delayMs: number, clipboard: ClipboardLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard): Promise<boolean> {
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
  } catch {
    return false;
  }
  const mine = ++latestCopy;
  setTimeout(() => {
    if (mine === latestCopy) void clipboard.writeText('').catch(() => undefined);
  }, delayMs);
  return true;
}
