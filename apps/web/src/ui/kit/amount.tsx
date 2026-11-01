'use client'

import clsx from 'clsx'
import { useId, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react'
import { createTranslator } from '../i18n/i18n'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { formatMoney, formatSigned, signOf } from '../ledger/format'
import { MASK_FIGURE_CLASS, zeroed } from '../privacy/mask'
import { usePrivacy, useRevealed } from '../privacy/usePrivacy'

interface AmountProps {
  minor: bigint
  currency: string
  locale: string
  tone?: 'neutral' | 'auto'
  showSign?: boolean
  align?: 'end'
  className?: string
  /** For an amount inside something clickable (a row that is a link or a button): while masked it is plain text a click reveals, never a second control inside the first. */
  inert?: boolean
}

/**
 * A monetary amount (FR-042). Takes bigint minor units and prints them exactly: tabular figures, the locale's grouping, a real minus sign
 * and the currency code. Direction is in the text (the sign), so colour is never the only cue: `tone="auto"` colours by sign and always
 * writes the plus of a gain.
 *
 * With Privacy mode on (spec 016, 018) it shows the same figure with every digit a zero, blurred, and keeps the sign, the colour and the currency code,
 * and a click, a tap or Enter or Space shows this one amount for a few seconds. The zeros are generated content, so no digit is in the page text.
 */
export function Amount(props: AmountProps) {
  const { on } = usePrivacy()
  return on ? <RevealableAmount {...props} /> : <AmountSpan {...props} masked={false} />
}

/**
 * The amount as one element. Masked, it is the same text with every digit a zero (blurred), with the sign, the colour and the currency code kept. Shown, it is exactly the plain amount. It is the same element in both states, so a revealed amount that has keyboard focus keeps it, also when it hides again.
 */
function AmountSpan({ minor, currency, locale, tone = 'neutral', showSign = false, align, className, masked, hiddenLabel, ...extra }: AmountProps & { masked: boolean; hiddenLabel?: string } & HTMLAttributes<HTMLSpanElement>) {
  const sign = signOf(minor)
  const text = showSign || (tone === 'auto' && sign === 'gain') ? formatSigned(minor, currency, locale) : formatMoney(minor, currency, locale)
  const classes = clsx(
    'tabular-nums whitespace-nowrap',
    align === 'end' && 'block text-end',
    tone === 'auto' && sign === 'gain' && 'text-(--success)',
    tone === 'auto' && sign === 'loss' && 'text-(--danger)',
    className
  )
  if (masked) {
    // The figure's own shape in zeros, blurred; the zeros are generated content from an attribute (not a text node), hidden from assistive technology, which gets the label instead.
    const figure = text.endsWith(` ${currency}`) ? text.slice(0, -(currency.length + 1)) : text
    return (
      <span {...extra} data-sign={sign} className={classes}>
        <span aria-hidden="true" data-privacy-mask data-zeros={zeroed(figure)} className={MASK_FIGURE_CLASS} /> <span aria-hidden="true">{currency}</span>
        {hiddenLabel === undefined ? null : <span className="sr-only">{hiddenLabel}</span>}
      </span>
    )
  }
  return (
    <span {...extra} data-sign={sign} className={classes}>
      {text}
    </span>
  )
}

function RevealableAmount(props: AmountProps) {
  const { currency, locale, inert = false } = props
  const { reveal } = usePrivacy()
  const id = useId()
  const revealed = useRevealed(id)
  const i18n = useOptionalI18n()
  const show = (event: MouseEvent | KeyboardEvent) => {
    // An amount inside a clickable row is revealed and does not also open the row.
    event.stopPropagation()
    if (!('key' in event)) event.preventDefault()
    reveal(id)
  }
  const { inert: _inert, ...rest } = props
  void _inert
  const hiddenLabel = (i18n?.t ?? createTranslator(locale))('privacy.amount.hidden', { currency })
  const common = {
    onClick: show,
    // The zeros have the figure's own length, so revealing it moves nothing around it.
    className: clsx('cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-(--focus)', props.className),
  }
  // Inside something clickable the amount is plain text, so a reader is told by a hidden label; as a button it is told by the button's name.
  if (inert) return <AmountSpan {...rest} {...common} masked={!revealed} {...(revealed ? {} : { hiddenLabel })} />
  return (
    <AmountSpan
      {...rest}
      {...common}
      masked={!revealed}
      tabIndex={0}
      // Masked it is a button with a name that says no figure; shown it is the figure itself, read as text.
      {...(revealed ? {} : { role: 'button', 'aria-label': hiddenLabel })}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          show(event)
        }
      }}
    />
  )
}
