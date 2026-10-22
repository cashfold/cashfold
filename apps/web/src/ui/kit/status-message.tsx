import { CheckIcon, XMarkIcon } from './icons'

/**
 * One brief confirmation ("Transaction saved"). Presentational: shell/StatusProvider owns the queue and the live region (role="status"), so
 * the message is announced once, does not take focus and goes away by itself (FR-013).
 */
export function StatusMessage({ message, dismissLabel, onDismiss }: { message: string; dismissLabel: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-x-3 rounded-xl bg-zinc-900 py-2.5 ps-4 pe-2 text-sm/6 text-white shadow-lg ring-1 ring-white/10 motion-safe:transition dark:bg-zinc-100 dark:text-zinc-950 forced-colors:border forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
      <CheckIcon aria-hidden="true" className="size-5 shrink-0 text-(--primary) dark:text-(--primary)" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="relative grid size-8 place-items-center rounded-lg hover:bg-white/10 focus:outline-hidden focus-visible:outline-2 focus-visible:outline-(--focus) dark:hover:bg-zinc-950/10"
      >
        <span aria-hidden="true" className="absolute inset-0 m-auto size-11 pointer-fine:hidden" />
        <XMarkIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}
