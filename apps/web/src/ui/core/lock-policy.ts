// When the app covers its content and when it tells the session worker the window was left (FR-007 of spec 001, amended for the desktop app by
// spec 006).
//
// In a browser, losing focus or being hidden covers the content at once and starts the worker's short timers: another tab or window is a normal
// thing to look at, and a browser tab is easy to leave on a shared screen. In the desktop app, clicking another window is just that, so by default
// it neither covers nor locks. The person can opt in to the browser behaviour. A hidden window is still covered from view, but it does not start
// the hidden-window timer: the idle time governs it instead, and the computer locking, sleeping or idling locks the app through the shell's events.

export interface LockPolicyInput {
  readonly isDesktop: boolean;
  /** The "hide the content when I switch to another window" preference. Only the desktop app has it. */
  readonly hideOnBlur: boolean;
}

export interface SessionHandlerDeps {
  readonly policy: () => LockPolicyInput;
  readonly setHidden: (hidden: boolean) => void;
  readonly setBlurred: (blurred: boolean) => void;
  /** Tells the session worker (fire and forget). */
  readonly notify: (method: string, args?: unknown) => void;
}

export interface SessionHandlers {
  onVisibility(state: 'hidden' | 'visible'): void;
  onBlur(): void;
  onFocus(): void;
}

const coversOnBlur = (policy: LockPolicyInput): boolean => !policy.isDesktop || policy.hideOnBlur;

export function createSessionHandlers(deps: SessionHandlerDeps): SessionHandlers {
  // Whether this blur covered the content: the desktop app lifts the cover on focus only if it put one up, even if the preference changed since.
  let covering = false;
  return {
    onVisibility(state) {
      const hidden = state === 'hidden';
      // Never show financial content in a window that is not on screen, on either platform.
      deps.setHidden(hidden);
      if (!deps.policy().isDesktop) deps.notify('session.visibility', { state });
    },
    onBlur() {
      const policy = deps.policy();
      if (!coversOnBlur(policy)) return;
      covering = true;
      deps.setBlurred(true);
      deps.notify('session.focus', { focused: false });
    },
    onFocus() {
      // The browser always reports focus, as it always has.
      if (deps.policy().isDesktop && !covering) return;
      covering = false;
      deps.setBlurred(false);
      deps.notify('session.focus', { focused: true });
    },
  };
}
