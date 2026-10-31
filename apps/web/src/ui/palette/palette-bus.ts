// How the palette is asked to open without the caller holding its state: the page's own key listener, the desktop shell's `palette` action and
// the Help dialog all use this one signal. Like overlay-signal.ts, it is plain data and callbacks, so it can be tested without a DOM.
export type PaletteRequest = 'open' | 'toggle';
type Listener = (request: PaletteRequest) => void;

const listeners = new Set<Listener>();

/** Registers the palette host. Returns the function that removes it. */
export function subscribePalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Opens the palette if it is closed. With no host mounted (the app is locked) nothing happens. */
export function openPalette(): void {
  for (const listener of [...listeners]) listener('open');
}

/** Opens the palette if it is closed and closes it if it is open. */
export function togglePalette(): void {
  for (const listener of [...listeners]) listener('toggle');
}
