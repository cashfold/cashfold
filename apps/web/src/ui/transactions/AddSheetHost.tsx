'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useMemo, type ReactNode } from 'react';
import { AddSheet } from './AddSheet';
import { AddContext, type AddApi, type AddRequest } from '../shell/add-context';

const TYPES = ['expense', 'income', 'transfer'] as const;

/** Reads `?new=` from the address: which add sheet is open, if any. Closing the sheet removes the parameter, so Back closes it too. */
export function useAddRequest(): AddRequest | undefined {
  const params = useSearchParams();
  const type = params.get('new');
  if (!TYPES.some((t) => t === type)) return undefined;
  return { type: type as AddRequest['type'], accountId: params.get('account') ?? undefined };
}

/** Where the sheet itself is rendered. It reads the address, so the static export needs it inside a Suspense boundary. */
function AddSheetSlot() {
  const request = useAddRequest();
  const router = useRouter();
  const pathname = usePathname();
  const close = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete('new');
    if (request?.accountId !== undefined && pathname !== '/transactions/') next.delete('account');
    const query = next.toString();
    router.replace(query === '' ? pathname : `${pathname}?${query}`);
  }, [router, pathname, request?.accountId]);
  return request === undefined ? null : <AddSheet request={request} onClose={close} />;
}

/** Provides `openAdd` to the whole shell and renders the add sheet while the address asks for it. */
export function AddSheetHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const openAdd = useCallback(
    (request: AddRequest = {}) => {
      // Read at call time, so this provider does not itself depend on the query string.
      const next = new URLSearchParams(window.location.search);
      next.set('new', request.type ?? 'expense');
      if (request.accountId !== undefined) next.set('account', request.accountId);
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname],
  );
  const api = useMemo<AddApi>(() => ({ openAdd }), [openAdd]);
  return (
    <AddContext.Provider value={api}>
      {children}
      <Suspense fallback={null}>
        <AddSheetSlot />
      </Suspense>
    </AddContext.Provider>
  );
}
