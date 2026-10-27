'use client';

import { useEffect } from 'react';
import { getDesktopBridge } from '../../adapters/platform';
import { applyFrameState } from './frame-attributes';

/** Keeps the window's frame state (full screen, maximised, translucent material) on <html> for the CSS: at start, and whenever the shell reports a change. */
export default function FrameInsets() {
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge === undefined) return;
    let live = true;
    // The first state: the material is on when the capability report says so; a window never starts in full screen.
    void bridge.settings.get().then(
      ({ capabilities }) => live && applyFrameState(document.documentElement, { fullscreen: false, maximized: false, translucent: capabilities.translucency === 'active' }),
      () => undefined,
    );
    const stop = bridge.onFrameState((state) => applyFrameState(document.documentElement, state));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return null;
}
