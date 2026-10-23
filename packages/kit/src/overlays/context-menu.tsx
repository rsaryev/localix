'use client'

import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/mini-app-sdk/ui/focus'
import { OVERLAY_ENTER_EXIT, OVERLAY_SLIDE } from './overlay-motion'
import { createMenuRows } from './menu-rows'
import { MENU_CONTENT, POPOVER_SURFACE } from './popover-surface'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuSub = ContextMenuPrimitive.Sub

const rows = createMenuRows(
  ContextMenuPrimitive,
  'max-h-[var(--radix-context-menu-content-available-height)] origin-(--radix-context-menu-content-transform-origin)',
)
const ContextMenuSubTrigger = rows.SubTrigger
const ContextMenuSubContent = rows.SubContent

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, collisionPadding = 8, ...props }, ref) => {
  const claimRef = useOverlayFocus('menu', ref)
  return (
    <ContextMenuPortal>
      <ContextMenuPrimitive.Content
        ref={claimRef}
        collisionPadding={collisionPadding}
        className={cn(
          // Material owned by POPOVER_SURFACE — same slab as Popover/DropdownMenu.
          POPOVER_SURFACE,
          MENU_CONTENT,
          OVERLAY_ENTER_EXIT,
          OVERLAY_SLIDE.far,
          'max-h-[var(--radix-context-menu-content-available-height)]',
          'origin-(--radix-context-menu-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </ContextMenuPortal>
  )
})
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = rows.Item
/** A multi-select row, check at the END like a `selected` row — see `createMenuRows`. */
const ContextMenuCheckboxItem = rows.CheckboxItem
const ContextMenuLabel = rows.Label
const ContextMenuSeparator = rows.Separator

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
}
