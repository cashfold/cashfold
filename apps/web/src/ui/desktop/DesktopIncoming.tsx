'use client';

import type { IncomingItem } from '@cashfold/platform';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDesktopBridge } from '../../adapters/platform';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Notice } from '../kit';
import { STATUS_MS, StatusRegion, type StatusItem } from '../shell/StatusProvider';
import { addDevicePrefill } from './add-device-prefill';
import { importHandoff } from './import-handoff';
import { keptWhileLocked, routeIncoming } from './incoming';
import { restoreHandoff } from './restore-handoff';

/** Items that arrive together (several files opened at once) come within this time of each other: the first opens, the rest wait. */
const BURST_MS = 1_500;

const asFile = (name: string, bytes: Uint8Array, type: string): File => new File([bytes as BlobPart], name, { type });

/**
 * In both shells, desktop app only: takes what the shell hands over from outside (a CSV, a backup, a `cashfold://` link, a refusal), opens the right
 * screen for review, and tells the person when something was refused. One item is opened at a time; the rest wait behind a "show the next one" button.
 * A locked page keeps no file contents: they are dropped when the app locks.
 */
export default function DesktopIncoming() {
  const core = useCore();
  const router = useRouter();
  const { t } = useI18n();
  const [message, setMessage] = useState<StatusItem | undefined>();
  const [waiting, setWaiting] = useState<readonly IncomingItem[]>([]);
  const latest = useRef({ phase: core.phase, router, t });
  latest.current = { phase: core.phase, router, t };
  const queue = useRef<IncomingItem[]>([]);
  const deferred = useRef<IncomingItem[]>([]);
  const openedAt = useRef(Number.NEGATIVE_INFINITY);

  const open = useCallback((item: IncomingItem) => {
    const { phase, router: r, t: translate } = latest.current;
    openedAt.current = Date.now();
    for (const effect of routeIncoming(item, phase)) {
      if (effect.type === 'navigate') r.push(effect.href);
      else if (effect.type === 'offer-csv') importHandoff.offer(asFile(effect.name, effect.bytes, 'text/csv'));
      else if (effect.type === 'offer-backup') restoreHandoff.offer(asFile(effect.name, effect.bytes, 'application/octet-stream'));
      else if (effect.type === 'prefill-add-device') addDevicePrefill.offer({ ...(effect.email === undefined ? {} : { email: effect.email }), ...(effect.server === undefined ? {} : { server: effect.server }) });
      else if (effect.type === 'message') setMessage({ id: Date.now(), message: translate(effect.key) });
      else deferred.current.push(item);
    }
  }, []);

  const showNext = useCallback(() => {
    const next = queue.current.shift();
    setWaiting([...queue.current]);
    if (next !== undefined) open(next);
  }, [open]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge === undefined) return;
    return bridge.onIncoming((item) => {
      // The first item opens at once; any that arrive together with it wait for the person to ask for them. A later item replaces what is on screen:
      // nothing was imported or restored, so nothing is lost.
      if (queue.current.length === 0 && Date.now() - openedAt.current > BURST_MS) open(item);
      else {
        queue.current.push(item);
        setWaiting([...queue.current]);
      }
    });
    // The listener is registered once; it reads the queue and the clock through refs.
  }, [open]);

  // Locked: file contents go (a lock must not leave a backup in the page's memory); links stay. Whenever the page learns where it stands, what waited for
  // that is looked at again: items that arrived while it was still asking the worker, and links that waited for the unlock.
  useEffect(() => {
    if (core.phase !== 'unlocked') {
      queue.current = keptWhileLocked(queue.current) as IncomingItem[];
      setWaiting([...queue.current]);
      deferred.current = keptWhileLocked(deferred.current);
    }
    if (core.phase === 'loading') return;
    for (const item of deferred.current.splice(0)) open(item);
  }, [core.phase, open]);

  useEffect(() => {
    if (message === undefined) return;
    const timer = setTimeout(() => setMessage(undefined), STATUS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <>
      {message === undefined ? null : <StatusRegion items={[message]} dismissLabel={t('status.dismiss')} onDismiss={() => setMessage(undefined)} />}
      {waiting.length === 0 ? null : (
        <div className="fixed inset-x-0 top-2 z-40 mx-auto w-full max-w-md px-4" data-testid="incoming-waiting">
          <Notice title={t('desktop.incoming.more', { count: waiting.length })} action={<Button plain type="button" onClick={showNext}>{t('desktop.incoming.next')}</Button>} />
        </div>
      )}
    </>
  );
}
