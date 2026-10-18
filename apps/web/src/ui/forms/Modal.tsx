'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A modal dialog on the platform `<dialog>`: focus moves in, Escape closes, focus returns to what opened it. */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} className="w-full max-w-lg rounded-ui border border-border-strong bg-bg p-6 text-text" onClose={onClose}>
      {open ? (
        <>
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {children}
        </>
      ) : null}
    </dialog>
  );
}
