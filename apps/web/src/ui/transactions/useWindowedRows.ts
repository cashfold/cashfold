'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** How far beyond the viewport a block still counts as near (in px): enough that scrolling never shows an empty gap. */
const MARGIN_PX = 1200;

/**
 * Keeps a block of the list in the page only while it is near the viewport (FR-027, research R-UX-12). A block that is far away is not rendered:
 * its element keeps the height it had (or `estimatePx` before it was ever seen) so the scrollbar and the scroll position do not move.
 * `eager` blocks, the first ones, render at once. Without IntersectionObserver every block stays rendered.
 */
export function useWindowedBlock<T extends HTMLElement>(eager: boolean, estimatePx: number): { ref: RefObject<T | null>; rendered: boolean } {
  const ref = useRef<T>(null);
  const height = useRef(estimatePx);
  const [near, setNear] = useState(eager);
  const supported = typeof IntersectionObserver !== 'undefined';
  const rendered = near || !supported;

  // The element's height is set through the CSSOM, which the page's style policy allows (a style attribute in the markup it does not).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (rendered) el.style.removeProperty('height');
    else el.style.height = `${height.current}px`;
  }, [rendered]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !supported) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        if (!entry.isIntersecting && el.childElementCount > 0) height.current = el.offsetHeight;
        setNear(entry.isIntersecting);
      },
      { rootMargin: `${MARGIN_PX}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [supported]);

  return { ref, rendered };
}
