import { ConfirmDialog } from '@localixai/kit/confirm-dialog'

/**
 * The question asked before a message is rolled back, from the message menu and from `/rewind`:
 * the same words, because it is the same loss.
 */
export function RollbackConfirmDialog({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Roll back this message?"
      description="This message and all replies after it will be removed. The text will be restored to the input."
      confirmLabel="Roll back"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
