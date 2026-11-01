'use client';

import { isAmountExpression } from '@cashfold/core';
import type { ReactNode } from 'react';
import { InputField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { decimalsOf, formatMoney } from '../ledger/format';
import { useLedger } from '../ledger/LedgerProvider';

/**
 * The one money input. It parses what was typed exactly: "1.239" in a two-decimal currency is an error the person sees, never a silent rounding.
 * A sum such as "12.50 + 3.20 * 2" is worked out exactly (spec 020): the sum stays in the field as typed, the result is shown in the note under the
 * field (in a polite live region), and the result is what the form saves. The keyboard is the full one, because the number pad has no operators.
 */
export function AmountInput({ label, currency, value, onChange, hint, error, required, disabled, autoFocus }: {
  label: string; currency: string; value: string; onChange: (text: string) => void; hint?: ReactNode | undefined; error?: ReactNode | undefined;
  required?: boolean | undefined; disabled?: boolean | undefined; autoFocus?: boolean;
}) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const known = currency !== '';
  const parsed = !known || value.trim() === '' ? undefined : ledger.parse(value, currency);
  const typedSum = parsed !== undefined && isAmountExpression(value);
  // Until the evaluator is loaded a sum is neither an error nor a result.
  const waiting = typedSum && !ledger.mathReady;
  const sum = typedSum && !waiting;
  let problem: ReactNode;
  if (parsed !== undefined && !parsed.ok && !waiting) {
    const code = parsed.error.code === 'invalid_format' && sum ? 'invalid_expression' : parsed.error.code;
    problem = t(`ledger.amount.${code}`, { decimals: decimalsOf(currency), currency });
  } else {
    problem = error;
  }
  // A valid sum shows its result in place of the usual hint; a plain number shows the usual hint.
  const note: ReactNode = sum && parsed !== undefined && parsed.ok
    ? <span aria-live="polite" aria-atomic="true" data-testid="amount-result">{t('ledger.amount.result', { amount: formatMoney(parsed.value, currency, locale) })}</span>
    : hint ?? t('ledger.amount.hint', { decimals: decimalsOf(currency) });
  return (
    <InputField
      label={known ? `${label} (${currency})` : label} value={value} onChange={(e) => onChange(e.target.value)} inputMode="text" autoComplete="off" placeholder={t('ledger.amount.placeholder')}
      hint={note} error={problem} {...(required ? { required: true } : {})} {...(disabled ? { disabled: true } : {})} {...(autoFocus ? { autoFocus: true } : {})}
    />
  );
}
