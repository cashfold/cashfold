'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * A QR code drawn as SVG from text. Black on white with a quiet border, so any scanner reads it in light or dark mode. The generator is loaded when a
 * code is first drawn (it is the largest single piece of the interface), and until then a blank white square of the same size holds the place.
 */
export function QrCode({ text, label, size = 160 }: { text: string; label: string; size?: number }) {
  const [matrix, setMatrix] = useState<boolean[][] | undefined>();
  useEffect(() => {
    let live = true;
    import('../emergency-kit/qr')
      .then((module) => {
        if (live) setMatrix(module.qrMatrix(text));
      })
      .catch(() => undefined); // without the generator the square stays blank; the code the person is given as text still works
    return () => {
      live = false;
    };
  }, [text]);
  const quiet = 4;
  const side = (matrix?.length ?? 25) + quiet * 2;
  const path = useMemo(() => (matrix ?? []).flatMap((row, r) => row.flatMap((dark, c) => (dark ? [`M${c + quiet} ${r + quiet}h1v1h-1z`] : []))).join(''), [matrix]);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${side} ${side}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
