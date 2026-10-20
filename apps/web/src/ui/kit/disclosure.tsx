'use client'

import clsx from 'clsx'
import React, { useId, useState } from 'react'
import { ChevronDownIcon } from './icons'

/**
 * A collapsible group ("More details", the secondary sections of the Overview). The button names the group and shows `summary` while it is
 * collapsed. Uncontrolled with `defaultOpen`, or controlled with `open`; `onOpenChange` reports the person's toggles only.
 */
export function Disclosure({
  title,
  summary,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: {
  title: React.ReactNode
  summary?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  children: React.ReactNode
}) {
  const [inner, setInner] = useState(defaultOpen)
  const open = controlled ?? inner
  const panelId = useId()
  return (
    <div className={clsx(className, 'rounded-lg border border-zinc-950/10 dark:border-white/10')} data-open={open ? '' : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setInner(!open)
          onOpenChange?.(!open)
        }}
        className="flex min-h-11 w-full items-center gap-x-3 rounded-lg px-3.5 py-2 text-start text-base/6 font-medium text-zinc-950 focus:outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus) sm:text-sm/6 dark:text-white"
      >
        <span className="flex-1">{title}</span>
        {!open && summary ? <span className="min-w-0 truncate text-sm/6 font-normal text-zinc-600 dark:text-zinc-400">{summary}</span> : null}
        <ChevronDownIcon aria-hidden="true" className={clsx('size-5 shrink-0 text-zinc-600 motion-safe:transition-transform dark:text-zinc-400', open && 'rotate-180')} />
      </button>
      <div id={panelId} role="region" aria-label={typeof title === 'string' ? title : undefined} hidden={!open} className="px-3.5 pt-1 pb-3.5">
        {open ? children : null}
      </div>
    </div>
  )
}
