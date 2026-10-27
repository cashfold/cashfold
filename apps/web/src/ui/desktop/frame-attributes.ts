import type { FrameState } from '@cashfold/platform';

// The frame of the desktop window as the page's CSS sees it: attributes on <html> (globals.css). The platform and the kind of frame are set before
// first paint by the bootstrap script; these set the parts that change while the app runs.

interface Root {
  readonly dataset: Record<string, string | undefined>;
}

/** Whether the window has the app's own bar (macOS and Windows; Linux keeps the system's title bar). */
export const hasOwnBar = (platform: string | undefined): boolean => platform === 'darwin' || platform === 'win32';

/** Applies what the shell reports about the window: full screen (the traffic lights are gone), maximised, and whether the translucent material is on. */
export function applyFrameState(root: Root, state: FrameState): void {
  root.dataset['fullscreen'] = String(state.fullscreen);
  root.dataset['maximized'] = String(state.maximized);
  root.dataset['translucent'] = String(state.translucent);
}
