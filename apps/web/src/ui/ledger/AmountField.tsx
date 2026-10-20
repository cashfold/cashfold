'use client';

import { useI18n } from '../i18n/I18nProvider';
import { TextField } from '../forms/TextField';
import { decimalsOf } from './format';
import { useLedger } from './LedgerProvider';

/**
 * A money input that parses what was typed exactly. It never rounds: "1.239" in a two-decimal currency is an error the
 * person sees, not a silent 1.24. The parsed value comes from `ledger.parse(text, currency)` when the form is submitted.
 */
export function AmountField({ label, currency, value, onChange, hint, required }: {
  label: string; currency: string; value: string; onChange: (text: string) => void; hint?: string | undefined; required?: boolean | undefined;
}) {
  const { t } = useI18n();
  const ledger = useLedger();
  const parsed = value.trim() === '' ? undefined : ledger.parse(value, currency);
  const problem = parsed !== undefined && !parsed.ok ? t(`ledger.amount.${parsed.error.code}`, { decimals: decimalsOf(currency), currency }) : undefined;
  return (
    <TextField
      label={`${label} (${currency})`} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoComplete="off"
      hint={hint ?? t('ledger.amount.hint', { decimals: decimalsOf(currency) })} error={problem} required={required}
    />
  );
}
