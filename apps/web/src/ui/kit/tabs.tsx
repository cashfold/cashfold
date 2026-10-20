'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export interface TabItem {
  value: string
  label: React.ReactNode
  count?: number
}

/** A segmented tab control (Plan: Budgets, Goals, Schedules). Arrow keys move between tabs; the content of the selected tab is `children`. */
export function Tabs({
  value,
  onChange,
  items,
  label,
  children,
  className,
}: {
  value: string
  onChange: (value: string) => void
  items: readonly TabItem[]
  label: string
  children?: React.ReactNode
  className?: string
}) {
  const index = Math.max(0, items.findIndex((i) => i.value === value))
  return (
    <Headless.TabGroup selectedIndex={index} onChange={(i) => onChange(items[i]!.value)} className={className}>
      <Headless.TabList aria-label={label} className="flex gap-1 rounded-xl bg-zinc-950/5 p-1 dark:bg-white/10">
        {items.map((item) => (
          <Headless.Tab
            key={item.value}
            className={clsx(
              'flex min-h-9 flex-1 items-center justify-center gap-x-2 rounded-lg px-3 py-1.5 text-sm/6 font-medium text-zinc-600 focus:outline-hidden dark:text-zinc-400',
              'data-focus:outline-2 data-focus:outline-offset-1 data-focus:outline-(--focus)',
              'data-hover:text-zinc-950 dark:data-hover:text-white',
              'data-selected:bg-white data-selected:text-zinc-950 data-selected:shadow-sm dark:data-selected:bg-zinc-800 dark:data-selected:text-white',
              'forced-colors:data-selected:bg-[Highlight] forced-colors:data-selected:text-[HighlightText]'
            )}
          >
            {item.label}
            {item.count === undefined ? null : <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{item.count}</span>}
          </Headless.Tab>
        ))}
      </Headless.TabList>
      {children === undefined ? null : (
        <Headless.TabPanels className="mt-4">
          {items.map((item) => (
            <Headless.TabPanel key={item.value} className="focus:outline-hidden focus-visible:outline-2 focus-visible:outline-(--focus)">
              {children}
            </Headless.TabPanel>
          ))}
        </Headless.TabPanels>
      )}
    </Headless.TabGroup>
  )
}
