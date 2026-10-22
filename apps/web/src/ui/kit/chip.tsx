import clsx from 'clsx'
import { XMarkIcon } from './icons'

/** A removable chip for an applied filter. The remove button is named with `removeLabel` (e.g. "Remove filter: Food"). */
export function Chip({ label, onRemove, removeLabel, className }: { label: string; onRemove: () => void; removeLabel: string; className?: string }) {
  return (
    <span className={clsx(className, 'inline-flex items-center gap-x-1 rounded-full bg-zinc-950/5 py-0.5 ps-3 pe-1 text-sm/6 text-zinc-950 dark:bg-white/10 dark:text-white')}>
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="relative grid size-6 place-items-center rounded-full text-zinc-600 hover:bg-zinc-950/10 focus:outline-hidden focus-visible:outline-2 focus-visible:outline-(--focus) dark:text-zinc-400 dark:hover:bg-white/10"
      >
        <span aria-hidden="true" className="absolute inset-0 m-auto size-11 pointer-fine:hidden" />
        <XMarkIcon aria-hidden="true" className="size-4" />
      </button>
    </span>
  )
}
