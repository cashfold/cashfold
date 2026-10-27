import type { IncomingItem } from '@cashfold/platform';
import type { Phase } from '../core/CoreProvider';
import { PRIMARY_SECTIONS } from '../shell/routes';

// What the page does with something that came from outside (the desktop shell has already checked it): only open the right screen for review. Nothing is
// imported, restored or signed in on arrival.

export type IncomingEffect =
  | { readonly type: 'navigate'; readonly href: string }
  | { readonly type: 'offer-csv'; readonly name: string; readonly bytes: Uint8Array }
  | { readonly type: 'offer-backup'; readonly name: string; readonly bytes: Uint8Array }
  | { readonly type: 'prefill-add-device'; readonly email?: string; readonly server?: string }
  | { readonly type: 'message'; readonly key: string }
  /** Keep it until the app is unlocked. */
  | { readonly type: 'wait' };

const LINK_REASONS: ReadonlySet<string> = new Set(['too-long', 'scheme', 'host', 'fragment', 'user-info', 'port', 'parameter', 'repeated', 'email', 'server', 'control', 'encoding', 'target']);
const FILE_REASONS: ReadonlySet<string> = new Set(['empty', 'extension', 'not-regular', 'too-large', 'unreadable']);

/** The message for a refused item. The reason is a code the shell chose; nothing from the item is in it. */
export function refusalKey(reason: string): string {
  if (reason === 'secret') return 'desktop.incoming.refused.secret';
  if (reason === 'queue-full') return 'desktop.incoming.refused.queueFull';
  if (LINK_REASONS.has(reason)) return 'desktop.incoming.refused.link';
  if (FILE_REASONS.has(reason)) return `desktop.incoming.refused.${reason}`;
  return 'desktop.incoming.refused.generic';
}

const SECTION_HREF = new Map(PRIMARY_SECTIONS.map((section) => [section.id as string, section.href]));

export function routeIncoming(item: IncomingItem, phase: Phase): IncomingEffect[] {
  // Until the page knows whether there is an account (it is still asking the worker), nothing can be decided: keep the item and ask again then.
  if (phase === 'loading' && item.kind !== 'refused') return [{ type: 'wait' }];
  switch (item.kind) {
    case 'refused':
      return [{ type: 'message', key: refusalKey(item.reason) }];
    case 'csv':
    case 'backup': {
      // The shell sends file contents only to an unlocked page; if one arrives anyway, it is not opened.
      if (phase !== 'unlocked') return [{ type: 'message', key: 'desktop.incoming.unlockFirst' }];
      return [{ type: item.kind === 'csv' ? 'offer-csv' : 'offer-backup', name: item.name, bytes: item.bytes }, { type: 'navigate', href: '/settings/data/' }];
    }
    case 'link': {
      if (item.link.screen === 'add-device') {
        // With an account already here there is nothing to add, and nothing is offered that could be destructive.
        if (phase !== 'no_account') return [{ type: 'message', key: 'desktop.incoming.hasAccount' }];
        const { email, server } = item.link;
        return [{ type: 'prefill-add-device', ...(email === undefined ? {} : { email }), ...(server === undefined ? {} : { server }) }, { type: 'navigate', href: '/add/' }];
      }
      if (phase === 'no_account') return [{ type: 'navigate', href: '/sign-up/' }];
      if (phase !== 'unlocked') return [{ type: 'wait' }];
      const href = SECTION_HREF.get(item.link.target);
      return href === undefined ? [] : [{ type: 'navigate', href }];
    }
  }
}

/** The items to keep while the page is not unlocked: links only. File contents are never held by a locked page. */
export const keptWhileLocked = (items: readonly IncomingItem[]): IncomingItem[] => items.filter((item) => item.kind === 'link');
