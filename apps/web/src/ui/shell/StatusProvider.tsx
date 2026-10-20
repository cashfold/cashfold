'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { StatusMessage } from '../kit/status-message';
import { useI18n } from '../i18n/I18nProvider';

// Brief, non-blocking confirmations ("Transaction saved") in one polite live region (FR-013). They never take focus, go away after about four
// seconds, can be dismissed, and offer no undo (spec clarification Q1).

export const STATUS_MS = 4000;
export const MAX_VISIBLE = 3;

export interface StatusItem {
  readonly id: number;
  readonly message: string;
}
export type StatusAction = { type: 'add'; item: StatusItem } | { type: 'dismiss'; id: number };

export function statusReducer(items: readonly StatusItem[], action: StatusAction): readonly StatusItem[] {
  if (action.type === 'dismiss') return items.filter((i) => i.id !== action.id);
  // The newest messages stay; a flood never grows the region without bound.
  return [...items, action.item].slice(-MAX_VISIBLE);
}

/** The live region and its messages. The region is always rendered, so a message added later is announced once, in place. */
export function StatusRegion({ items, dismissLabel, onDismiss }: { items: readonly StatusItem[]; dismissLabel: string; onDismiss: (id: number) => void }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-y-2 px-4">
      {items.map((item) => (
        <StatusMessage key={item.id} message={item.message} dismissLabel={dismissLabel} onDismiss={() => onDismiss(item.id)} />
      ))}
    </div>
  );
}

interface StatusApi {
  notify(messageKey: string, params?: Record<string, string | number>): void;
}
const StatusContext = createContext<StatusApi | undefined>(undefined);

export function StatusProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, dispatch] = useReducer(statusReducer, []);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    dispatch({ type: 'dismiss', id });
  }, []);

  const notify = useCallback(
    (messageKey: string, params?: Record<string, string | number>) => {
      const id = next.current++;
      dispatch({ type: 'add', item: { id, message: t(messageKey, params) } });
      timers.current.set(id, setTimeout(() => dismiss(id), STATUS_MS));
    },
    [t, dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);
  return (
    <StatusContext.Provider value={api}>
      {children}
      <StatusRegion items={items} dismissLabel={t('status.dismiss')} onDismiss={dismiss} />
    </StatusContext.Provider>
  );
}

export function useStatus(): StatusApi {
  const api = useContext(StatusContext);
  if (!api) throw new Error('useStatus needs a StatusProvider');
  return api;
}
