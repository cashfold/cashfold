'use client'

import type React from 'react'
import { Listbox, ListboxLabel, ListboxOption } from './listbox'

type Value = string | number

/**
 * A single choice from a short list, built on the kit's Listbox. `onChange` receives the chosen value (not an event). Options are `SelectOption`s.
 * Inside a kit `Field` the button is labelled by the field's `Label`; on its own it needs `aria-label` or an `id` matching a `<label htmlFor>`.
 */
export function Select<T extends Value>({
  children,
  onChange,
  ...props
}: {
  value: T
  onChange: (value: T) => void
  id?: string
  className?: string
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  'aria-label'?: string
  children?: React.ReactNode
}) {
  return (
    <Listbox<T> {...props} onChange={onChange}>
      {children}
    </Listbox>
  )
}

export function SelectOption<T extends Value>({
  value,
  disabled,
  children,
}: {
  value: T
  disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <ListboxOption<T> value={value} {...(disabled === undefined ? {} : { disabled })}>
      <ListboxLabel>{children}</ListboxLabel>
    </ListboxOption>
  )
}
