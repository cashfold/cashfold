// Keeps the browser's deferred install event (spec 009). Chromium fires `beforeinstallprompt` once and early, so this module is imported before anything
// else of the page and registers its listener at once. It stops the browser showing its own prompt (nothing appears unasked, FR-003) and offers the
// prompt only when a person presses Install.

export interface DeferredPrompt {
  preventDefault(): void;
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

export interface CaptureSnapshot {
  readonly promptEvent: boolean;
  readonly installedInTab: boolean;
}

export interface InstallCapture {
  getSnapshot(): CaptureSnapshot;
  subscribe(listener: () => void): () => void;
  /** Shows the browser's install prompt. The event can be used once, so a second call answers `unavailable`. */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

interface EventSource {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

export function createInstallCapture(source: EventSource, options: { onInstalled?: () => void } = {}): InstallCapture {
  let deferred: DeferredPrompt | undefined;
  let installedInTab = false;
  // While the browser's prompt is open the event is used up but the person is still deciding: the app must not act as if nothing was offered.
  let prompting = false;
  let snapshot: CaptureSnapshot = { promptEvent: false, installedInTab: false };
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = { promptEvent: deferred !== undefined || prompting, installedInTab };
    for (const listener of [...listeners]) listener();
  };

  source.addEventListener('beforeinstallprompt', (event) => {
    (event as DeferredPrompt).preventDefault();
    deferred = event as DeferredPrompt;
    publish();
  });
  source.addEventListener('appinstalled', () => {
    deferred = undefined;
    installedInTab = true;
    publish();
    options.onInstalled?.();
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async prompt() {
      const event = deferred;
      if (event === undefined) return 'unavailable';
      deferred = undefined;
      prompting = true;
      publish();
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        // The browser says `appinstalled` right after an accepted prompt; this covers the moment between, so the section does not vanish.
        if (outcome === 'accepted') installedInTab = true;
        return outcome;
      } finally {
        prompting = false;
        publish();
      }
    },
  };
}
