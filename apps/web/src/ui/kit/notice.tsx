import clsx from 'clsx'
import type React from 'react'
import { ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from './icons'

const tones = {
  info: { box: 'border-zinc-950/10 bg-zinc-950/[0.03] dark:border-white/10 dark:bg-white/5', icon: 'text-zinc-600 dark:text-zinc-400', role: 'status' as const },
  warning: { box: 'border-(--warning)/40 bg-(--warning)/10', icon: 'text-(--warning)', role: 'alert' as const },
  danger: { box: 'border-(--danger)/40 bg-(--danger)/10', icon: 'text-(--danger)', role: 'alert' as const },
}

/**
 * An inline banner for a condition on the page: a missing exchange rate, a full disk, entries waiting for attention. Not a dialog (the kit's
 * `Alert` is the modal one). It has an icon and a lead-in `title`, so the tone is never colour alone; an optional action and dismiss button.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  dismissLabel,
  className,
  ...props
}: {
  tone?: keyof typeof tones
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
} & Omit<React.ComponentPropsWithoutRef<'div'>, 'title' | 'className'>) {
  const t = tones[tone]
  const Icon = tone === 'info' ? InformationCircleIcon : ExclamationTriangleIcon
  return (
    <div role={t.role} {...props} className={clsx(className, 'flex items-start gap-x-3 rounded-xl border p-3.5 text-sm/6 text-zinc-950 dark:text-white', t.box)}>
      <Icon aria-hidden="true" className={clsx('mt-0.5 size-5 shrink-0', t.icon)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={clsx(title && 'text-zinc-600 dark:text-zinc-300')}>{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="relative grid size-6 shrink-0 place-items-center rounded-md text-zinc-600 hover:bg-zinc-950/5 focus:outline-hidden focus-visible:outline-2 focus-visible:outline-(--focus) dark:text-zinc-400 dark:hover:bg-white/10"
        >
          <span aria-hidden="true" className="absolute inset-0 m-auto size-11 pointer-fine:hidden" />
          <XMarkIcon aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  )
}
