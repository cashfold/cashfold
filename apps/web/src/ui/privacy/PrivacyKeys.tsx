'use client';

import { useEffect, useMemo } from 'react';
import { useDesktop } from '../desktop/useDesktop';
import { isApplePlatform } from '../palette/palette-keys';
import { isPrivacyKey } from './privacy-keys';
import { usePrivacy } from './usePrivacy';

/** Listens for the Privacy mode key in a browser (the desktop app's shell sends an action instead). Mounted in the unlocked shell, so a locked app has no listener. */
export function PrivacyKeys() {
  const { toggle } = usePrivacy();
  const { isDesktop } = useDesktop();
  const apple = useMemo(() => isApplePlatform(), []);
  useEffect(() => {
    if (isDesktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPrivacyKey(event, apple)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, apple, toggle]);
  return null;
}
