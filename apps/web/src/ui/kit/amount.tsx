import clsx from 'clsx'
import { formatMoney, formatSigned, signOf } from '../ledger/format'

/**
 * A monetary amount (FR-042). Takes bigint minor units and prints them exactly: tabular figures, the locale's grouping, a real minus sign
 * and the currency code. Direction is in the text (the sign), so colour is never the only cue: `tone="auto"` colours by sign and always
 * writes the plus of a gain.
 */
export function Amount({
  minor,
  currency,
  locale,
  tone = 'neutral',
  showSign = false,
  align,
  className,
}: {
  minor: bigint
  currency: string
  locale: string
  tone?: 'neutral' | 'auto'
  showSign?: boolean
  align?: 'end'
  className?: string
}) {
  const sign = signOf(minor)
  const text = showSign || (tone === 'auto' && sign === 'gain') ? formatSigned(minor, currency, locale) : formatMoney(minor, currency, locale)
  return (
    <span
      data-sign={sign}
      className={clsx(
        'tabular-nums whitespace-nowrap',
        align === 'end' && 'block text-end',
        tone === 'auto' && sign === 'gain' && 'text-(--success)',
        tone === 'auto' && sign === 'loss' && 'text-(--danger)',
        className
      )}
    >
      {text}
    </span>
  )
}
