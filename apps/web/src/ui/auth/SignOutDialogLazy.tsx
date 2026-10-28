'use client';

import { useEffect, useState, type ComponentType } from 'react';
import type { SignOutDialogProps } from './SignOutDialog';

// The confirmation is used from the unlock form, which every gated page carries, so importing it directly would copy its code into each page's
// chunk. It is only needed once someone opens it, so it is loaded then, as one chunk (the same way the desktop-only parts are loaded).
export function SignOutDialogLazy(props: SignOutDialogProps) {
  const [Loaded, setLoaded] = useState<ComponentType<SignOutDialogProps> | undefined>();
  const { open } = props;
  useEffect(() => {
    if (!open || Loaded !== undefined) return;
    let live = true;
    import('./SignOutDialog')
      .then((module) => {
        if (live) setLoaded(() => module.SignOutDialog);
      })
      .catch(() => undefined); // offline with the chunk uncached: the button simply does nothing, and the person can try again
    return () => {
      live = false;
    };
  }, [open, Loaded]);
  return Loaded === undefined ? null : <Loaded {...props} />;
}
