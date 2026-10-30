'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isDesktopApp } from '../../adapters/platform/detect';
import { forgetShownReminders } from '../../adapters/notifications/browser';
import { useDesktop } from '../desktop/DesktopSettingsProvider';
import { createCoreClient, type CoreClient, type CoreEvent } from './core-client';
import { prefsStore } from '../prefs/usePrefs';
import { paletteHistory } from '../palette/history';
import { resetAccountPrefs } from '../prefs/reset-account';
import { createSessionHandlers } from './lock-policy';

export type Phase = 'loading' | 'no_account' | 'locked' | 'unlocked' | 'failed';

export interface AccountInfo {
  readonly email: string;
  readonly accountId: string;
  readonly server: string;
  readonly registration: 'pending' | 'done' | 'local';
}

export interface Core {
  readonly phase: Phase;
  readonly account: AccountInfo | undefined;
  /** True while the window is hidden or out of focus: financial content must not show (FR-007). A locked app shows its own screen. */
  readonly covered: boolean;
  /** Increments each time the Core Worker finishes locking and is replaced. Screens that ask the worker questions re-ask when it changes. */
  readonly epoch: number;
  call<R = unknown>(method: string, args?: unknown): Promise<R>;
  refresh(): Promise<void>;
  lock(): void;
  /** Marks the app unlocked after a successful sign-up or unlock. */
  markUnlocked(): Promise<void>;
  /** True after a write failed because the device is out of space. Nothing was lost; the person is told to make room. */
  readonly storageFull: boolean;
  /** True after this device was removed from the account from another device: its data was erased. */
  readonly removed: boolean;
  /** Hears the worker's events (sync status, changes from other devices). Returns the way to stop listening. */
  subscribe(listener: (event: CoreEvent) => void): () => void;
  /** Set by a sign-out (spec 011) for the signed-out screen: this device may still be listed under the account on the service. Cleared when the person starts any way back in. */
  readonly signedOutNotice: { readonly deviceStillListed: boolean } | undefined;
  showSignedOutNotice(notice: { readonly deviceStillListed: boolean }): void;
  dismissSignedOutNotice(): void;
}

const Context = createContext<Core | null>(null);

/** Runs `use` with the password as bytes and wipes the page's copy straight afterwards. */
export async function withPasswordBytes<T>(password: string, use: (bytes: Uint8Array) => Promise<T>): Promise<T> {
  const bytes = new TextEncoder().encode(password);
  try {
    return await use(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** What the page keeps that belongs to the account that is gone: the Fold-keyed recents, the hidden Getting started card, the list of shown reminders, the command palette's history. */
export function forgetAccountScopedState(): void {
  prefsStore.update(resetAccountPrefs);
  forgetShownReminders();
  paletteHistory.clear();
}

const ACTIVITY_THROTTLE_MS = 5_000;
const SESSION_CHECK_MS = 5_000;

export function CoreProvider({ children, makeWorker }: { children: ReactNode; makeWorker?: () => Worker }) {
  const clientRef = useRef<CoreClient | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [account, setAccount] = useState<AccountInfo | undefined>();
  const [hidden, setHidden] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [removed, setRemoved] = useState(false);
  const [signedOutNotice, setSignedOutNotice] = useState<{ readonly deviceStillListed: boolean } | undefined>();
  const [storageFull, setStorageFull] = useState(false);
  const desktop = useDesktop();
  // The listeners below are registered once; they read the current preference from here.
  const hideOnBlurRef = useRef(false);
  hideOnBlurRef.current = desktop.settings.hideOnBlur;
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;

  const client = useCallback((): CoreClient => {
    clientRef.current ??= createCoreClient(makeWorker ?? (() => new Worker(new URL('../../worker/core-worker.ts', import.meta.url), { type: 'module', name: 'cashfold-core' })), { timeoutMs: 60_000 });
    return clientRef.current;
  }, [makeWorker]);

  const refresh = useCallback(async () => {
    try {
      const status = await client().call<{ phase: Exclude<Phase, 'loading' | 'failed'>; email?: string; accountId?: string; server?: string; registration?: 'pending' | 'done' | 'local'; finishedSignOut?: boolean }>('status');
      // A sign-out that was cut short has just been finished at start: what the page keeps for the old account goes now (the worker cannot reach it).
      if (status.finishedSignOut === true) forgetAccountScopedState();
      setPhase(status.phase);
      setAccount(status.email === undefined ? undefined : { email: status.email, accountId: status.accountId!, server: status.server!, registration: status.registration! });
    } catch {
      setPhase('failed');
    }
  }, [client]);

  useEffect(() => {
    const c = client();
    void refresh();
    const off = c.onEvent((event) => {
      if (event.type === 'Locked') {
        setPhase((p) => (p === 'no_account' ? p : 'locked'));
        setEpoch((n) => n + 1);
      }
      if (event.type === 'DeviceRemoved') {
        setRemoved(true);
        setPhase('no_account');
        setAccount(undefined);
        setEpoch((n) => n + 1);
        forgetAccountScopedState();
      }
      // Signed out here or in another tab (spec 011): the same as a removed device, without the notice that it was removed.
      if (event.type === 'SignedOut') {
        setPhase('no_account');
        setAccount(undefined);
        setEpoch((n) => n + 1);
        forgetAccountScopedState();
      }
    });
    return () => {
      off();
    };
  }, [client, refresh]);

  // Another tab holds the unlocked session. If that tab goes (closed, crashed, or it locked), this one is promoted to the worker that keeps the
  // database, which starts locked: ask now and then, so the page shows the unlock screen instead of a screen that no longer works.
  useEffect(() => {
    if (phase !== 'unlocked') return;
    const timer = setInterval(() => {
      client().call<{ phase: Exclude<Phase, 'loading' | 'failed'> }>('status').then(
        (status) => status.phase !== 'unlocked' && setPhase(status.phase),
        () => undefined,
      );
    }, SESSION_CHECK_MS);
    return () => clearInterval(timer);
  }, [phase, client]);

  // Hide content the moment the window is hidden or loses focus, before the worker has even heard about it. In the desktop app, losing focus
  // is just another window being used, so it does that only if the person asked (lock-policy.ts).
  useEffect(() => {
    const c = client();
    const handlers = createSessionHandlers({
      policy: () => ({ isDesktop: isDesktopApp(), hideOnBlur: hideOnBlurRef.current }),
      setHidden,
      setBlurred,
      notify: (method, args) => c.notify(method, args),
    });
    const onVisibility = () => handlers.onVisibility(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
    const onBlur = () => handlers.onBlur();
    const onFocus = () => handlers.onFocus();
    const onPageHide = () => c.notify('session.pageHide');
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last > ACTIVITY_THROTTLE_MS) {
        last = now;
        c.notify('session.activity');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('freeze', onPageHide);
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, onActivity, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('freeze', onPageHide);
      for (const type of ['pointerdown', 'keydown']) window.removeEventListener(type, onActivity);
    };
  }, [client]);

  // The desktop shell reports the computer locking, sleeping or going idle: lock exactly as the Lock button does.
  const lockNow = useCallback(() => {
    if (phaseRef.current !== 'unlocked') return;
    setPhase('locked');
    client().notify('lock');
  }, [client]);
  const desktopBridge = desktop.ready ? desktop.bridge() : undefined;
  useEffect(() => desktopBridge?.onSystemLock(lockNow), [desktopBridge, lockNow]);
  // Tell the shell whether the app is locked, so its own surfaces (menus, badge, recent Folds) show nothing while it is.
  useEffect(() => {
    void desktopBridge?.reportSession(phase === 'unlocked' ? 'unlocked' : 'locked');
  }, [desktopBridge, phase]);

  const value = useMemo<Core>(
    () => ({
      phase,
      account,
      covered: hidden || blurred,
      epoch,
      storageFull,
      call: async (method, args) => {
        try {
          return await client().call(method, args);
        } catch (e) {
          if ((e as { code?: unknown } | null)?.code === 'storage_full') setStorageFull(true);
          throw e;
        }
      },
      refresh,
      lock() {
        setPhase('locked');
        client().notify('lock');
      },
      async markUnlocked() {
        setRemoved(false);
        setSignedOutNotice(undefined);
        await refresh();
      },
      removed,
      subscribe: (listener) => client().onEvent(listener),
      signedOutNotice,
      showSignedOutNotice: setSignedOutNotice,
      dismissSignedOutNotice: () => setSignedOutNotice(undefined),
    }),
    [phase, account, hidden, blurred, epoch, removed, storageFull, signedOutNotice, client, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCore(): Core {
  const value = useContext(Context);
  if (value === null) throw new Error('useCore must be used inside CoreProvider');
  return value;
}
