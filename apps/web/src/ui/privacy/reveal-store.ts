// Which amounts the person has chosen to show right now (spec 016, research R4). It lives in memory only: nothing here is stored, logged or put in an
// address, and it is cleared whenever the person could be looking at something else (navigation, leaving the window, locking, switching the mode).

/** How long an amount stays shown after it was revealed. */
export const REVEAL_MS = 5000;

type Listener = () => void;

const revealed = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

export function isRevealed(id: string): boolean {
  return revealed.has(id);
}

/** How many amounts are shown now. */
export const shownCount = (): number => revealed.size;

/** Shows one amount for `REVEAL_MS`; revealing it again starts the time over. No other amount is shown. */
export function reveal(id: string): void {
  const running = timers.get(id);
  if (running !== undefined) clearTimeout(running);
  revealed.add(id);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      if (revealed.delete(id)) notify();
    }, REVEAL_MS),
  );
  notify();
}

/** Hides every amount at once and stops the timers. Tells subscribers only if something was shown. */
export function clear(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (revealed.size === 0) return;
  revealed.clear();
  notify();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

