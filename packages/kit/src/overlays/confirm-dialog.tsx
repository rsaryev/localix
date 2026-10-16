import { AlertDialog } from 'radix-ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/plugin-sdk/ui/focus'
import { Button } from '../controls/button'
import { modalBody, modalDescription, modalShell, modalSurface, modalTitle } from './modal-surface'
import { ModalFooterRegion, ModalHeaderRegion } from './modal-regions'
import { OVERLAY_ENTER_EXIT, SCRIM_ENTER_EXIT } from './overlay-motion'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'default'
  onConfirm: () => void
  /** Owns the controlled `open` state for every dismissal path, including a decision. */
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  // Claimed like every other modal: without it nothing that reads the focus stack knows a
  // confirmation is up — not the global shortcuts, and not the desktop browser page, which has to
  // step aside for it.
  const claimRef = useOverlayFocus<HTMLDivElement>('dialog')
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <AlertDialog.Portal>
        {/* `lx-scrim` owns the material, same as the Dialog/Drawer overlays. */}
        <AlertDialog.Overlay
          className={cn('lx-scrim fixed inset-0 z-(--z-modal-backdrop)', SCRIM_ENTER_EXIT)}
        />
        <AlertDialog.Content
          ref={claimRef}
          className={cn(
            modalSurface,
            modalShell,
            'fixed left-1/2 top-1/2 z-(--z-modal) max-h-[calc(100dvh-2rem)] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-control-border p-0',
            OVERLAY_ENTER_EXIT,
          )}
        >
          <ModalHeaderRegion slot="alert-dialog">
            <AlertDialog.Title className={modalTitle}>{title}</AlertDialog.Title>
          </ModalHeaderRegion>
          {description && (
            <div className={modalBody}>
              <AlertDialog.Description className={modalDescription}>
                {description}
              </AlertDialog.Description>
            </div>
          )}
          <ModalFooterRegion slot="alert-dialog" actionsLabel="Confirmation actions">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" className="text-text-soft">
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={variant === 'destructive' ? 'destructive-solid' : 'mono'}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </ModalFooterRegion>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
