import clsx from 'clsx'

/**
 * A progress bar with its status in words (FR-030, FR-042): a native `<progress>` (so it is a progressbar for assistive technology), a visible
 * `statusText` and a tone. The fill is drawn by the element itself, so no inline style is needed (R-UX-03).
 */
export function Progress({
  value,
  max,
  label,
  statusText,
  tone = 'neutral',
  className,
}: {
  value: number
  max: number
  label: string
  statusText: string
  tone?: 'neutral' | 'good' | 'warning' | 'danger'
  className?: string
}) {
  return (
    <div className={className}>
      <progress
        value={Math.min(Math.max(value, 0), max)}
        max={max}
        aria-label={label}
        className={clsx(
          'block h-2 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-zinc-200 dark:[&::-webkit-progress-bar]:bg-white/10',
          '[&::-webkit-progress-value]:bg-(--bar) [&::-moz-progress-bar]:bg-(--bar) bg-zinc-200 dark:bg-white/10',
          tone === 'neutral' && '[--bar:var(--primary)]',
          tone === 'good' && '[--bar:var(--success)]',
          tone === 'warning' && '[--bar:var(--warning)]',
          tone === 'danger' && '[--bar:var(--danger)]',
          'forced-colors:[--bar:Highlight]'
        )}
      />
      <p className={clsx('mt-1 text-sm/6', tone === 'danger' ? 'text-(--danger)' : tone === 'warning' ? 'text-(--warning)' : 'text-zinc-600 dark:text-zinc-400')}>{statusText}</p>
    </div>
  )
}
