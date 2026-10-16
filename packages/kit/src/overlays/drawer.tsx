import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/plugin-sdk/ui/focus'
import { modalBody, modalDescription, modalShell, modalSurface, modalTitle } from './modal-surface'
import { POPOVER_MATERIAL } from './popover-surface'
import {
  ModalFooterRegion,
  ModalHeaderRegion,
  type ModalFooterRegionOwnerProps,
  type ModalHeaderRegionOwnerProps,
} from './modal-regions'

const Drawer = (props: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root data-slot="drawer" {...props} />
)
Drawer.displayName = 'Drawer'

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    data-slot="drawer-overlay"
    // Material comes from `lx-scrim` (see index.css) — the same one the dialog
    // overlay uses, so a drawer dims the page by exactly as much as a dialog.
    className={cn('lx-scrim fixed inset-0 z-(--z-modal-backdrop)', className)}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
    /** `popover` renders the drawer in the floating-menu material (the frosted `--popover`
     *  panel every dropdown/context-menu uses) instead of the denser modal surface — for
     *  drawers that ARE pickers (the model browser), so picking a model looks like picking
     *  a session. Default stays the modal material. */
    material?: 'modal' | 'popover'
  }
>(({ className, children, material = 'modal', ...props }, ref) => {
  const claimRef = useOverlayFocus('dialog', ref)
  return (
    <DrawerPortal>
      {/* A picker-material drawer dims by half (`lx-scrim-light`): it is a quick in-and-out,
          so the page behind stays readable for context instead of going dark. */}
      <DrawerOverlay className={material === 'popover' ? 'lx-scrim-light' : undefined} />
      <DrawerPrimitive.Content
        ref={claimRef}
        data-slot="drawer-content"
        className={cn(
          material === 'popover' ? POPOVER_MATERIAL : modalSurface,
          modalShell,
          'fixed inset-x-0 bottom-0 z-(--z-modal) mt-24 h-auto max-h-[calc(100dvh-0.5rem)] overscroll-contain focus:outline-none',
          'rounded-t-2xl border-t border-control-border',
          'md:max-w-205 md:mx-auto md:w-full',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          // Foreground veil at grab-handle strength, not `bg-muted/70`: `muted` is itself a 6%
          // veil under glass, so `/70` of it was a 4.2% fill and the drag handle — the only
          // affordance saying the sheet can be dragged — was invisible.
          className="mx-auto mt-4 h-1.5 w-14 shrink-0 cursor-grab rounded-full bg-foreground/20 active:cursor-grabbing"
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
})
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = ({ className, ...props }: ModalHeaderRegionOwnerProps) => (
  <ModalHeaderRegion
    slot="drawer"
    className={cn('text-center sm:text-left', className)}
    {...props}
  />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div data-slot="drawer-body" className={cn(modalBody, className)} {...props} />
)
DrawerBody.displayName = 'DrawerBody'

const DrawerFooter = ({ className, ...props }: ModalFooterRegionOwnerProps) => (
  <ModalFooterRegion slot="drawer" className={cn('mt-auto', className)} {...props} />
)
DrawerFooter.displayName = 'DrawerFooter'

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    data-slot="drawer-title"
    className={cn(modalTitle, className)}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    data-slot="drawer-description"
    className={cn(modalDescription, className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
