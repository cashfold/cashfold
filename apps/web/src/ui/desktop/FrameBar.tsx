'use client';

import { hasOwnBar } from './frame-attributes';

/**
 * The slim bar at the top of the desktop window on macOS and Windows, where the title bar is part of the app: a place to drag the window by (the CSS
 * makes it a drag region and every control in it `no-drag`), with the system's window buttons inside it. Nothing else is in it; the app's own controls
 * stay in the navigation. Linux keeps the system's title bar and renders nothing here.
 */
export default function FrameBar() {
  const platform = typeof document === 'undefined' ? undefined : document.documentElement.dataset['platform'];
  if (!hasOwnBar(platform)) return null;
  return <div className="frame-bar" data-testid="frame-bar" aria-hidden="true">Cashfold</div>;
}
