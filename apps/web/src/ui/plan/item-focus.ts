'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

// The command palette opens a budget or a goal as `/plan/?view=…&item=<id>` (spec 015, research R3). The view scrolls that row into view, puts the cursor
// on it once, and takes the parameter out of the address so a reload or Back does not repeat it. An id that is not in the list changes nothing.

/** The `item` the address asks for, if the list has it. */
export function requestedItem(search: string, ids: readonly string[]): string | undefined {
  const item = new URLSearchParams(search).get('item');
  return item !== null && ids.includes(item) ? item : undefined;
}

/** The address without `item`, keeping every other parameter. */
export function withoutItem(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('item');
  const rest = params.toString();
  return rest === '' ? pathname : `${pathname}?${rest}`;
}

const MAX_WAIT_FRAMES = 90;
/** A dialog is open or still leaving: focus set now would be taken back when it finishes closing (it returns focus to where it came from). */
const dialogBusy = (): boolean => document.querySelector('[role="dialog"],[data-leave],[data-closed]') !== null;

/** Call with the ids of the rows the view shows; each row carries `data-item-id` and `tabIndex={-1}`. */
export function useFocusItem(ids: readonly string[]): void {
  const search = useSearchParams().toString();
  const pathname = usePathname();
  const router = useRouter();
  const key = ids.join('\n');
  useEffect(() => {
    const item = requestedItem(search, ids);
    if (item === undefined) return;
    let frame = 0;
    let waited = 0;
    let cancelled = false;
    // The palette that opened this has just closed; wait for it to finish leaving so the cursor is not taken back from the row.
    const attempt = () => {
      if (cancelled) return;
      const row = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(item)}"]`);
      if (row !== null && !dialogBusy()) {
        row.scrollIntoView?.({ block: 'center' });
        row.focus();
        router.replace(withoutItem(pathname, search));
        return;
      }
      if (++waited < MAX_WAIT_FRAMES) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [search, key]);
}

export const ITEM_ROW_PROPS = (id: string) => ({ 'data-item-id': id, tabIndex: -1 }) as const;
export const ITEM_ROW_CLASS = 'outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--focus)';
