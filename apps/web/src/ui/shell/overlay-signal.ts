// A desktop shortcut arrives from the shell while the Help dialog, or the navigation drawer under it, is open. Both close before the shortcut's action
// runs, so it does not run behind a panel that makes the page unreachable (spec 008, FR-017).
type Listener = () => boolean | void;
const listeners = new Set<Listener>();

/** Registers something that can be closed. It answers whether it was open (a listener that has no answer counts as having been open). */
export function subscribeOverlays(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Closes the Help dialog and the narrow-window drawer, if open. Returns how many were open. */
export function dismissOverlays(): number {
  let closed = 0;
  for (const listener of [...listeners]) if (listener() !== false) closed++;
  return closed;
}

const FRAME_MS = 16;
const GIVE_UP_MS = 1_000;

/** Runs `run` once the closing panels have finished leaving the screen (they fade out), or after a second at the latest. */
export function afterOverlaysLeave(run: () => void, leaving: () => boolean = () => document.querySelector('[data-leave],[data-closed]') !== null): void {
  let waited = 0;
  const check = () => {
    if (!leaving() || waited >= GIVE_UP_MS) return run();
    waited += FRAME_MS;
    setTimeout(check, FRAME_MS);
  };
  check();
}
