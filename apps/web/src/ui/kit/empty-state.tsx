import clsx from 'clsx'
import type React from 'react'

/** What a list shows when it is empty (FR-037): an icon, one sentence of purpose and the primary action. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ComponentType<React.ComponentPropsWithoutRef<'svg'>>
  title: React.ReactNode
  body: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx(className, 'flex flex-col items-center gap-y-3 rounded-xl border border-dashed border-zinc-950/15 px-6 py-10 text-center dark:border-white/15')}>
      <Icon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-500" />
      <p className="text-base/6 font-semibold text-zinc-950 dark:text-white">{title}</p>
      <p className="max-w-prose text-sm/6 text-zinc-600 dark:text-zinc-400">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
