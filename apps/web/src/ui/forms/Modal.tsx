'use client';

import type { ReactNode } from 'react';
import { Sheet } from '../kit';

/** A dialog for the screens that still build their own forms: the kit's sheet (bottom-anchored on narrow screens, centred from `sm`). */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  // Unmounted while closed (no leave transition): nested dialogs that close in the same pass would otherwise leave the page behind hidden.
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title={title}>
      {children}
    </Sheet>
  );
}
