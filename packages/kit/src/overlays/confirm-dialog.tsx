import type { ReactNode } from 'react'
import { AlertDialog } from 'radix-ui'
import { CircleHelp, TriangleAlert } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/mini-app-sdk/ui/focus'
import { Button } from '../controls/button'
import { modalBody, modalDescription, modalShell, modalSurface, modalTitle } from './modal-surface'
import { DialogHero } from './dialog-hero'
import { ModalFooterRegion, ModalHeaderRegion } from './modal-regions'
import { MODAL_ENTER_EXIT, SCRIM_ENTER_EXIT } from './overlay-motion'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'default'
  /**
   * The mark the question opens with (a lucide icon). Defaults by `variant`: a warning for a
   * destructive action, a question otherwise. Name the action when it has an icon of its own —
   * a bin for a delete, a plug for a disconnect.
   */
  icon?: ReactNode
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
  icon,
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
            MODAL_ENTER_EXIT,
          )}
        >
          {/* One centred column: the mark, the question, its detail, then the two answers side by
              side at equal width — a decision reads top to bottom and ends on a choice. */}
          <ModalHeaderRegion
            slot="alert-dialog"
            className="pt-6 pb-1.5 text-center [&>[data-slot=alert-dialog-header-main]]:items-center"
          >
            {/* Every confirmation arrives the same way: its mark, in the colour of what it does. */}
            <DialogHero
              tone={variant === 'destructive' ? 'danger' : 'accent'}
              icon={icon ?? (variant === 'destructive' ? <TriangleAlert /> : <CircleHelp />)}
            />
            <AlertDialog.Title className={modalTitle}>{title}</AlertDialog.Title>
          </ModalHeaderRegion>
          {description && (
            <div data-slot="alert-dialog-body" className={cn(modalBody, 'text-center')}>
              <AlertDialog.Description className={cn(modalDescription, 'text-balance')}>
                {description}
              </AlertDialog.Description>
            </div>
          )}
          <ModalFooterRegion
            slot="alert-dialog"
            actionsLabel="Confirmation actions"
            className="border-t-0 pt-1 pb-4 [&>[data-slot=alert-dialog-footer-actions]]:w-full [&>[data-slot=alert-dialog-footer-actions]]:flex-row [&>[data-slot=alert-dialog-footer-actions]>*]:flex-1"
          >
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" className="text-text-soft">
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
