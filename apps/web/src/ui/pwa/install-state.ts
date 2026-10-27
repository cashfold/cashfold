// The install state of the web app (spec 009, data-model "InstallState"): a pure function of a few facts, so it tests without a browser.

export type StepsKind = 'ios-safari' | 'ios-other' | 'mac-safari';

export type InstallState =
  /** Before the first answer. */
  | { readonly kind: 'unknown' }
  /** The browser handed over a deferred install event: an Install button works. */
  | { readonly kind: 'promptable' }
  /** The browser installs only by hand: the steps for `steps` are shown. */
  | { readonly kind: 'steps'; readonly steps: StepsKind }
  /** Running as an installed app, in its own window. */
  | { readonly kind: 'installed' }
  /** The install event fired while this tab is open. */
  | { readonly kind: 'installed-in-tab' }
  /** Nothing can be installed: the desktop app, or a browser that cannot. */
  | { readonly kind: 'unavailable' };

export interface InstallFacts {
  readonly desktopApp: boolean;
  readonly installedWindow: boolean;
  readonly installedInTab: boolean;
  /** The browser's deferred install event is held and unused. */
  readonly promptEvent: boolean;
  /** How long the page has waited for an install event. */
  readonly waitedMs: number;
  readonly steps: StepsKind | undefined;
}

/** How long to wait for the browser's install event before saying the app cannot be installed. A late event still makes it promptable. */
export const UNKNOWN_WAIT_MS = 2_000;

export function installStateOf(facts: InstallFacts): InstallState {
  if (facts.desktopApp) return { kind: 'unavailable' };
  if (facts.installedWindow) return { kind: 'installed' };
  if (facts.installedInTab) return { kind: 'installed-in-tab' };
  if (facts.promptEvent) return { kind: 'promptable' };
  if (facts.steps !== undefined) return { kind: 'steps', steps: facts.steps };
  return facts.waitedMs >= UNKNOWN_WAIT_MS ? { kind: 'unavailable' } : { kind: 'unknown' };
}

interface PlatformFacts {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
}

/**
 * The steps a browser needs where it has no install event: Safari on iPhone and iPad (the share sheet), the other browsers on iOS (the same path since
 * iOS 16.4), and Safari 17 or later on a Mac (File, Add to Dock). Anything else is installed by its own button, or cannot be installed.
 * An iPad says it is a Mac, so a Mac with a touch screen is an iPad.
 */
export function stepsFor({ userAgent, maxTouchPoints }: PlatformFacts): StepsKind | undefined {
  const iPhoneOrIPod = /iPhone|iPod/.test(userAgent);
  const iPad = /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (iPhoneOrIPod || iPad) return /CriOS|EdgiOS|FxiOS|OPiOS/.test(userAgent) ? 'ios-other' : 'ios-safari';
  const mac = /Macintosh/.test(userAgent);
  const safari = /Safari\//.test(userAgent) && !/Chrome|Chromium|Edg\/|OPR\/|Firefox/.test(userAgent);
  const version = Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 0);
  return mac && safari && version >= 17 ? 'mac-safari' : undefined;
}
