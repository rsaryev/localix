import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/plugin-sdk/ui/focus'
import { Button } from '../controls/button'
import { IconButton } from '../controls/icon-button'
import { modalDescription, modalBody, modalShell, modalSurface, modalTitle } from './modal-surface'
import {
  ModalFooterRegion,
  ModalHeaderRegion,
  type ModalFooterRegionOwnerProps,
  type ModalHeaderRegionOwnerProps,
} from './modal-regions'
import { OVERLAY_ENTER_EXIT, OVERLAY_NO_MOTION, SCRIM_ENTER_EXIT } from './overlay-motion'
import { X } from 'lucide-react'

/**
 * The ONLY width API a dialog has. Call sites used to spell their measure into
 * `className` instead (`sm:max-w-xs`, `max-w-2xl`, `w-[min(420px,calc(100vw-2rem))]`),
 * which is how nine dialogs ended up on six different ladders — and how one of them
 * lost the viewport clamp the tier carries. `modal-surface.test.tsx` now fails any
 * `<DialogContent>` that writes a width utility of its own.
 */
const DIALOG_CONTENT_SIZE = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  /**
   * No tier: the CONTENT decides, clamped to the viewport. For media viewers whose
   * surface must hug the picture rather than a text measure (image-lightbox).
   */
  fit: 'w-auto max-w-[94vw] sm:max-w-[94vw]',
} as const

type DialogContentSize = keyof typeof DIALOG_CONTENT_SIZE
type DialogContentLayout = 'standard' | 'edge-to-edge'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // `lx-scrim` owns the material (fill + frosted backdrop + no-backdrop-filter
        // fallback), tuned per theme in index.css; this keeps only the placement,
        // stacking and the enter/exit animation classes.
        'lx-scrim fixed inset-0 isolate z-(--z-modal-backdrop)',
        SCRIM_ENTER_EXIT,
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'lg',
  layout = 'standard',
  appearance = 'surface',
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Semantic width tier. Defaults to the 512px working-dialog measure used by
   *  the reference workbenches; viewport clamping remains automatic. */
  size?: DialogContentSize
  /**
   * `standard` composes Header / Body / Footer with one scroll owner.
   * `edge-to-edge` is an explicit opt-in for self-contained viewers and quick input.
   */
  layout?: DialogContentLayout
  /** Media viewers present content directly over the full frosted modal backdrop. */
  appearance?: 'surface' | 'media'
}) {
  const claimRef = useOverlayFocus('dialog', ref)
  return (
    <DialogPortal>
      <DialogOverlay className={appearance === 'media' ? OVERLAY_NO_MOTION : undefined} />
      <DialogPrimitive.Content
        ref={claimRef}
        data-slot="dialog-content"
        data-layout={layout}
        className={cn(
          // One modal surface family app-wide: the same raised surface + border +
          // shadow the model-picker drawer uses (bg-surface-raised over the theme
          // tokens), so dialogs and drawers read as one system.
          appearance === 'surface' ? modalSurface : 'text-popover-foreground',
          modalShell,
          // The shell never scrolls. Standard dialogs put content in DialogBody,
          // leaving Header/Footer pinned; edge-to-edge dialogs intentionally own
          // their internal viewport. `min-h-0` is required for nested flex scroll.
          'fixed top-1/2 left-1/2 z-(--z-modal) max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-0 text-xs/relaxed outline-none',
          appearance === 'surface' && 'border border-control-border',
          appearance === 'surface' && OVERLAY_ENTER_EXIT,
          DIALOG_CONTENT_SIZE[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            {/* The SAME control every other dismissal in the app uses. This was a raw
                `Button variant="ghost" size="icon-sm"`, so the one close users meet most
                often was the only one that missed IconButton's idle/hover appearance and
                sat a tier below the 28px measure its neighbours keep. */}
            <IconButton
              size="md"
              className="absolute top-2 right-2 z-(--z-raised)"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </IconButton>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/**
 * `pr-10` (40px) is the close control's own footprint, not a guess: 8px inset +
 * the 28px `--chrome-control-md` square + a 4px gap before the title. It read
 * `pr-11` while the button was 24px, which reserved 12px of nothing.
 */
function DialogHeader({ className, ...props }: ModalHeaderRegionOwnerProps) {
  return <ModalHeaderRegion slot="dialog" className={cn('pr-10', className)} {...props} />
}

function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn(modalBody, className)} {...props} />
}

function DialogFooter({
  showCloseButton = false,
  children,
  ...props
}: ModalFooterRegionOwnerProps & {
  showCloseButton?: boolean
}) {
  return (
    <ModalFooterRegion slot="dialog" {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </ModalFooterRegion>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(modalTitle, className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        modalDescription,
        '*:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A modal interaction scoped to one positioned workbench pane.
 *
 * Quick input and contextual decisions should block only the surface that owns
 * them, while still getting the keyboard/focus guarantees of a real dialog.
 * Radix owns focus trapping, Escape and outside dismissal; omitting a Portal
 * intentionally keeps the overlay inside the nearest positioned pane instead
 * of promoting it to an application modal. The caller owns post-close focus
 * because workbench surfaces often restore a virtualized editor/terminal rather
 * than the button that opened the interaction.
 */
function PaneDialog({
  onClose,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Root>, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  return (
    <DialogPrimitive.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      {...props}
    />
  )
}

function PaneDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <>
      <DialogPrimitive.Overlay
        data-slot="pane-dialog-overlay"
        // Half-weight scrim, like the picker drawer: a pane dialog is scoped to its pane, so the
        // pane dims for focus without going dark. It was a hand-mixed `bg-black/20`, which is
        // the one scrim in the app that skipped the theme-tuned material and its fallbacks.
        className={cn('lx-scrim-light absolute inset-0 z-(--z-overlay)', SCRIM_ENTER_EXIT)}
      />
      <DialogPrimitive.Content
        data-slot="pane-dialog-content"
        aria-modal="true"
        className={cn(
          modalSurface,
          modalShell,
          'absolute top-[10%] left-1/2 z-(--z-overlay) max-h-[80%] w-[34rem] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-control-border p-0 text-xs/relaxed outline-none ring-1 ring-foreground/10',
          OVERLAY_ENTER_EXIT,
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </>
  )
}

function PaneDialogHeader(props: ModalHeaderRegionOwnerProps) {
  return <ModalHeaderRegion slot="pane-dialog" {...props} />
}

function PaneDialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="pane-dialog-body" className={cn(modalBody, className)} {...props} />
}

function PaneDialogFooter(props: ModalFooterRegionOwnerProps) {
  return <ModalFooterRegion slot="pane-dialog" {...props} />
}

function PaneDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="pane-dialog-title"
      className={cn(modalTitle, className)}
      {...props}
    />
  )
}

function PaneDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="pane-dialog-description"
      className={cn(modalDescription, className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  PaneDialog,
  PaneDialogBody,
  PaneDialogContent,
  PaneDialogDescription,
  PaneDialogFooter,
  PaneDialogHeader,
  PaneDialogTitle,
}
export type { DialogContentLayout, DialogContentSize }
