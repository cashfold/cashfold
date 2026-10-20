import clsx from 'clsx'
import type React from 'react'

/** A headline figure tile. `value` is usually an `<Amount>`, which carries the sign as text; `tone` only tints it. */
export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  tone?: 'gain' | 'loss' | 'neutral'
  hint?: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx(className, 'rounded-xl border border-zinc-950/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900')} data-tone={tone}>
      <dt className="text-sm/6 text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd
        className={clsx(
          'mt-1 text-2xl/8 font-semibold tabular-nums',
          tone === 'gain' && 'text-(--success)',
          tone === 'loss' && 'text-(--danger)',
          tone === 'neutral' && 'text-zinc-950 dark:text-white'
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-1 text-xs/5 text-zinc-600 dark:text-zinc-400">{hint}</dd> : null}
    </div>
  )
}
