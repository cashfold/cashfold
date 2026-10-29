'use client';

import { useEffect, useState, type ComponentType } from 'react';

// The signed-out screen is carried by every gated page (through RequireUnlocked) and the home page, but it is shown only on a device with no account.
// Importing it directly would copy it into every page's chunk, so it is loaded when it is first needed, as one shared chunk.
export function SignedOutChoicesLazy() {
  const [Loaded, setLoaded] = useState<ComponentType | undefined>();
  useEffect(() => {
    let live = true;
    import('./SignedOutChoices')
      .then((module) => {
        if (live) setLoaded(() => module.SignedOutChoices);
      })
      .catch(() => undefined); // the three links are also reachable from the address bar; nothing else depends on this
    return () => {
      live = false;
    };
  }, []);
  return Loaded === undefined ? null : <Loaded />;
}
