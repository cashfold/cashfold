// Whether the page runs as an installed app (its own window) and not in a browser tab. Chromium and Safari on Mac use the `display-mode` media query;
// Safari on iPhone and iPad also sets `navigator.standalone` for a home screen app.

interface Env {
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
  readonly navigator?: { readonly standalone?: boolean };
}

export function isInstalledWindow(env: Env = globalThis as unknown as Env): boolean {
  try {
    if (env.matchMedia?.('(display-mode: standalone)').matches === true) return true;
  } catch {
    // No answer is the same as "not installed".
  }
  return env.navigator?.standalone === true;
}
