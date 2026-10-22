import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

/** The main action of a list row: a button that looks like the row's text, so the whole title area opens the item. */
export function RowButton({ className, ...props }: { className?: string } & Omit<Headless.ButtonProps, 'as' | 'className'>) {
  return (
    <Headless.Button
      type="button"
      {...props}
      className={clsx(className, 'min-w-0 text-start focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-(--focus)')}
    />
  ) as React.ReactElement
}
