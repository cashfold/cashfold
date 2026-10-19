'use client';

import { QrCode } from './QrCode';

/** A fingerprint as eight groups of five digits, to read aloud or compare side by side, with the QR form beside it (FR-084). */
export function Fingerprint({ groups, qr, label, testId }: { groups: readonly string[]; qr?: string | undefined; label: string; testId?: string | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <p className="font-mono text-lg leading-relaxed tracking-wide" data-testid={testId} aria-label={label}>
        {groups.map((g, i) => (
          <span key={i} className="me-3 inline-block">{g}</span>
        ))}
      </p>
      {qr ? <QrCode text={qr} label={label} /> : null}
    </div>
  );
}
