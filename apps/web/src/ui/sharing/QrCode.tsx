'use client';

import { useMemo } from 'react';
import { qrMatrix } from '../emergency-kit/kit';

/** A QR code drawn as SVG from text. Black on white with a quiet border, so any scanner reads it in light or dark mode. */
export function QrCode({ text, label, size = 160 }: { text: string; label: string; size?: number }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  const quiet = 4;
  const side = matrix.length + quiet * 2;
  const path = useMemo(() => matrix.flatMap((row, r) => row.flatMap((dark, c) => (dark ? [`M${c + quiet} ${r + quiet}h1v1h-1z`] : []))).join(''), [matrix]);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${side} ${side}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
