'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useCore } from '../core/CoreProvider';
import { useStatus } from '../shell/StatusProvider';
import { carriesFiles, isFileInput } from './drop-events';
import { handleDrop } from './drop-handler';
import { importHandoff } from './import-handoff';

const RECEIPT_INPUT = 'dialog input#attachment-file, [role="dialog"] input#attachment-file';

/** In the unlocked shell, in the desktop app: a CSV dropped on the window goes to the import panel, a file dropped on the open add sheet becomes its receipt. */
export default function DropTarget() {
  const core = useCore();
  const router = useRouter();
  const status = useStatus();
  const latest = useRef({ core, router, status });
  latest.current = { core, router, status };

  useEffect(() => {
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event) || isFileInput(event.target)) return;
      const { core: c, router: r, status: s } = latest.current;
      const receipt = document.querySelector<HTMLInputElement>(RECEIPT_INPUT);
      handleDrop(Array.from(event.dataTransfer?.files ?? []), {
        unlocked: c.phase === 'unlocked',
        receiptSheetOpen: receipt !== null,
        offerCsv: (file) => importHandoff.offer(file),
        openImport: () => r.push('/settings/data/'),
        attachReceipt: (file) => {
          // The attachment field takes the file as if it had been chosen with its button, so it applies its own size check and shows it.
          const transfer = new DataTransfer();
          transfer.items.add(file);
          receipt!.files = transfer.files;
          receipt!.dispatchEvent(new Event('change', { bubbles: true }));
        },
        message: (key, params) => s.notify(key, params),
      });
    };
    window.addEventListener('drop', drop);
    return () => window.removeEventListener('drop', drop);
  }, []);
  return null;
}
