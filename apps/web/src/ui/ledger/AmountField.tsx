'use client';

import { AmountInput } from '../transactions/AmountInput';

/** The money input of the plan screens. It is the same component as everywhere else (see `AmountInput`), under its older name. */
export function AmountField({ label, currency, value, onChange, hint, required }: {
  label: string; currency: string; value: string; onChange: (text: string) => void; hint?: string | undefined; required?: boolean | undefined;
}) {
  return <AmountInput label={label} currency={currency} value={value} onChange={onChange} hint={hint} required={required} />;
}
