// Derived from Catalyst (Tailwind Plus). Licence: ./LICENSE-TAILWIND-PLUS.md
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'
import { Text } from './text'

const sizes = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  '5xl': 'sm:max-w-5xl',
}

export function Dialog({
  size = 'lg',
  placement = 'center',
  className,
  children,
  ...props
}: {
  size?: keyof typeof sizes
  /** `center`: a centred panel at every width. `sheet`: anchored to the bottom edge below `sm` (rounded top corners), centred from `sm` up. */
  placement?: 'center' | 'sheet'
  className?: string
  children: React.ReactNode
} & Omit<Headless.DialogProps, 'as' | 'className'>) {
  const sheet = placement === 'sheet'
  return (
    <Headless.Dialog {...props}>
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 flex w-screen justify-center overflow-y-auto bg-zinc-950/25 px-2 py-2 transition duration-100 focus:outline-0 data-closed:opacity-0 data-enter:ease-out data-leave:ease-in sm:px-6 sm:py-8 lg:px-8 lg:py-16 dark:bg-zinc-950/50"
      />

      <div className={clsx('fixed inset-0 w-screen overflow-y-auto', sheet && 'pt-6 sm:pt-0')}>
        <div
          className={clsx(
            'grid min-h-full justify-items-center sm:p-4',
            sheet ? 'grid-rows-[1fr_auto] sm:grid-rows-[1fr_auto_3fr]' : 'grid-rows-[1fr_auto_1fr] p-4'
          )}
        >
          <Headless.DialogPanel
            transition
            className={clsx(
              className,
              sizes[size],
              'row-start-2 w-full min-w-0 bg-white shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10 forced-colors:outline',
              sheet
                ? 'flex max-h-[calc(100dvh-1.5rem)] flex-col rounded-t-3xl p-(--gutter) [--gutter:--spacing(5)] sm:mb-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:[--gutter:--spacing(8)]'
                : 'rounded-2xl p-(--gutter) [--gutter:--spacing(6)] sm:[--gutter:--spacing(8)]',
              'transition duration-100 will-change-transform data-closed:translate-y-12 data-closed:opacity-0 data-enter:ease-out data-leave:ease-in sm:data-closed:translate-y-0 sm:data-closed:data-enter:scale-95'
            )}
          >
            {children}
          </Headless.DialogPanel>
        </div>
      </div>
    </Headless.Dialog>
  )
}

export function DialogTitle({
  className,
  ...props
}: { className?: string } & Omit<Headless.DialogTitleProps, 'as' | 'className'>) {
  return (
    <Headless.DialogTitle
      {...props}
      className={clsx(className, 'text-lg/6 font-semibold text-balance text-zinc-950 sm:text-base/6 dark:text-white')}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: { className?: string } & Omit<Headless.DescriptionProps<typeof Text>, 'as' | 'className'>) {
  return <Headless.Description as={Text} {...props} className={clsx(className, 'mt-2 text-pretty')} />
}

export function DialogBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'mt-6 min-h-0 flex-1 overflow-y-auto')} />
}

export function DialogActions({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'mt-8 flex shrink-0 flex-col-reverse items-center justify-end gap-3 *:w-full sm:flex-row sm:*:w-auto'
      )}
    />
  )
}
