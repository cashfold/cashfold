// Feature detection for the unsupported-browser gate. The app needs OPFS with synchronous access handles (the encrypted
// database), WebCrypto, Workers and WebAssembly, plus Web Locks and BroadcastChannel to keep one writer across tabs.
// A browser missing any of them cannot run the app safely, so it gets an explanation instead of a half-working UI.

export const REQUIRED_FEATURES = ['secure_context', 'opfs', 'webcrypto', 'workers', 'wasm', 'locks', 'broadcast'] as const;
export type RequiredFeature = (typeof REQUIRED_FEATURES)[number];

/** The slice of the global scope that detection reads. Injected so it can be tested without a browser. */
export interface SupportEnv {
  readonly isSecureContext?: boolean | undefined;
  readonly navigator?: { readonly storage?: { readonly getDirectory?: unknown } | undefined; readonly locks?: unknown } | undefined;
  readonly crypto?: { readonly subtle?: unknown; readonly getRandomValues?: unknown } | undefined;
  readonly Worker?: unknown;
  readonly WebAssembly?: unknown;
  readonly BroadcastChannel?: unknown;
  readonly FileSystemFileHandle?: unknown;
}

export interface SupportResult {
  readonly supported: boolean;
  readonly missing: readonly RequiredFeature[];
}

const present = (value: unknown): boolean => value !== undefined && value !== null;

export function detectSupport(env: SupportEnv): SupportResult {
  const check = (feature: RequiredFeature): boolean => {
    try {
      switch (feature) {
        case 'secure_context':
          return env.isSecureContext === true;
        case 'opfs':
          // createSyncAccessHandle exists only inside workers, so the main thread cannot test it. The Core Worker does, and reports
          // UnsupportedBrowser(opfs) if it is missing.
          return typeof env.navigator?.storage?.getDirectory === 'function' && typeof env.FileSystemFileHandle === 'function';
        case 'webcrypto':
          return present(env.crypto?.subtle) && typeof env.crypto?.getRandomValues === 'function';
        case 'workers':
          return typeof env.Worker === 'function';
        case 'wasm':
          return present(env.WebAssembly);
        case 'locks':
          return present(env.navigator?.locks);
        case 'broadcast':
          return typeof env.BroadcastChannel === 'function';
      }
    } catch {
      return false;
    }
  };
  const missing = REQUIRED_FEATURES.filter((f) => !check(f));
  return { supported: missing.length === 0, missing };
}

/** Detection against the real global scope. Call from the browser only. */
export function detectBrowserSupport(): SupportResult {
  return detectSupport(globalThis as unknown as SupportEnv);
}
