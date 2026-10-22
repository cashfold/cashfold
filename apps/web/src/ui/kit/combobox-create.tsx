'use client'

import { Combobox, ComboboxLabel, ComboboxOption } from './combobox'

/**
 * A combobox over existing names (payees, tags) that also offers to create the name being typed (FR-020). `createLabel` is the visible text of
 * the extra option ("Create ‘Coffee’"); choosing it calls `onChange` with the typed text, and the caller creates the record.
 */
export function ComboboxCreate({
  options,
  value,
  onChange,
  createLabel,
  onTextChange,
  toggleLabel,
  placeholder,
  autoFocus,
  'aria-label': ariaLabel,
  className,
}: {
  options: string[]
  value: string | null
  onChange: (value: string | null) => void
  createLabel: (typed: string) => string
  /** The text in the input as it is typed (chosen or not). */
  onTextChange?: (text: string) => void
  toggleLabel: string
  placeholder?: string
  autoFocus?: boolean
  'aria-label'?: string
  className?: string
}) {
  return (
    <Combobox<string | null>
      options={options}
      value={value}
      onChange={onChange}
      displayValue={(v) => v ?? ''}
      createOption={(typed) => typed}
      toggleLabel={toggleLabel}
      {...(onTextChange === undefined ? {} : { onQueryChange: onTextChange })}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      {...(className === undefined ? {} : { className })}
    >
      {(option) => (
        <ComboboxOption value={option}>
          <ComboboxLabel>{options.includes(option) ? option : createLabel(option)}</ComboboxLabel>
        </ComboboxOption>
      )}
    </Combobox>
  )
}
