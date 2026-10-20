import type React from 'react'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from './dialog'

/**
 * A panel for forms and short tasks (FR-007): bottom-anchored with rounded top corners on narrow screens, centred from `sm` up. The body
 * scrolls, the footer (the Save button) stays in view, and the panel is never taller than the dynamic viewport, so it stays usable with the
 * on-screen keyboard open.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} size={size} placement="sheet" className="mb-[env(keyboard-inset-height,0px)]">
      <DialogTitle>{title}</DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
      <DialogBody>{children}</DialogBody>
      {footer ? <DialogActions>{footer}</DialogActions> : null}
    </Dialog>
  )
}
