'use client';

import { InputField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { decimalsOf } from '../ledger/format';
import { useLedger } from '../ledger/LedgerProvider';

/** A money input that parses what was typed exactly: "1.239" in a two-decimal currency is an error the person sees, never a silent rounding. */
export function AmountInput({ label, currency, value, onChange, hint, autoFocus }: { label: string; currency: string; value: string; onChange: (text: string) => void; hint?: string | undefined; autoFocus?: boolean }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const parsed = value.trim() === '' ? undefined : ledger.parse(value, currency);
  const problem = parsed !== undefined && !parsed.ok ? t(`ledger.amount.${parsed.error.code}`, { decimals: decimalsOf(currency), currency }) : undefined;
  return (
    <InputField
      label={`${label} (${currency})`} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoComplete="off"
      hint={hint ?? t('ledger.amount.hint', { decimals: decimalsOf(currency) })} error={problem} {...(autoFocus ? { autoFocus: true } : {})}
    />
  );
}
