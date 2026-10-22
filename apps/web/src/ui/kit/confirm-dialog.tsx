import type React from 'react'
import { Alert, AlertActions, AlertDescription, AlertTitle } from './alert'
import { Button } from './button'

/**
 * A confirmation before something that cannot be undone or that loses what was typed (FR-012). The title names the thing, the body states the
 * consequence, the confirm button says what it does ("Delete transaction", not "OK"), and focus starts on Cancel, the safe choice.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: React.ReactNode
  body?: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Alert open={open} onClose={onCancel}>
      <AlertTitle>{title}</AlertTitle>
      {body ? <AlertDescription>{body}</AlertDescription> : null}
      <AlertActions>
        <Button plain autoFocus onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button color={destructive ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </AlertActions>
    </Alert>
  )
}
