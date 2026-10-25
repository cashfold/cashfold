// Derived from Catalyst (Tailwind Plus). Licence: ./LICENSE-TAILWIND-PLUS.md
import type React from 'react'

export function AuthLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh min-w-0 flex-col p-2 focus:outline-hidden">
      <div className="flex min-w-0 grow items-start justify-center p-4 sm:p-6 lg:items-center lg:rounded-lg lg:bg-white lg:p-10 lg:shadow-xs lg:ring-1 lg:ring-zinc-950/5 dark:lg:bg-zinc-900 dark:lg:ring-white/10">
        <div className="w-full min-w-0 max-w-lg">
          {children}
          {footer === undefined ? null : <div className="mt-8 flex justify-end">{footer}</div>}
        </div>
      </div>
    </main>
  )
}
