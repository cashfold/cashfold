'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createCoreClient, type CoreClient, type CoreEvent } from './core-client';

export type Phase = 'loading' | 'no_account' | 'locked' | 'unlocked' | 'failed';

export interface AccountInfo {
  readonly email: string;
  readonly accountId: string;
  readonly server: string;
  readonly registration: 'pending' | 'done';
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
  /** True after this device was removed from the account from another device: its data was erased. */
  readonly removed: boolean;
  /** Hears the worker's events (sync status, changes from other devices). Returns the way to stop listening. */
  subscribe(listener: (event: CoreEvent) => void): () => void;
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

const ACTIVITY_THROTTLE_MS = 5_000;

export function CoreProvider({ children, makeWorker }: { children: ReactNode; makeWorker?: () => Worker }) {
  const clientRef = useRef<CoreClient | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [account, setAccount] = useState<AccountInfo | undefined>();
  const [hidden, setHidden] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [removed, setRemoved] = useState(false);

  const client = useCallback((): CoreClient => {
    clientRef.current ??= createCoreClient(makeWorker ?? (() => new Worker(new URL('../../worker/core-worker.ts', import.meta.url), { type: 'module', name: 'cashfold-core' })), { timeoutMs: 60_000 });
    return clientRef.current;
  }, [makeWorker]);

  const refresh = useCallback(async () => {
    try {
      const status = await client().call<{ phase: Exclude<Phase, 'loading' | 'failed'>; email?: string; accountId?: string; server?: string; registration?: 'pending' | 'done' }>('status');
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
      }
    });
    return () => {
      off();
    };
  }, [client, refresh]);

  // Hide content the moment the window is hidden or loses focus, before the worker has even heard about it.
  useEffect(() => {
    const c = client();
    const onVisibility = () => {
      const isHidden = document.visibilityState === 'hidden';
      setHidden(isHidden);
      c.notify('session.visibility', { state: isHidden ? 'hidden' : 'visible' });
    };
    const onBlur = () => (setBlurred(true), c.notify('session.focus', { focused: false }));
    const onFocus = () => (setBlurred(false), c.notify('session.focus', { focused: true }));
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

  const value = useMemo<Core>(
    () => ({
      phase,
      account,
      covered: hidden || blurred,
      epoch,
      call: (method, args) => client().call(method, args),
      refresh,
      lock() {
        setPhase('locked');
        client().notify('lock');
      },
      async markUnlocked() {
        setRemoved(false);
        await refresh();
      },
      removed,
      subscribe: (listener) => client().onEvent(listener),
    }),
    [phase, account, hidden, blurred, epoch, removed, client, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCore(): Core {
  const value = useContext(Context);
  if (value === null) throw new Error('useCore must be used inside CoreProvider');
  return value;
}
