'use client'

import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/plugin-sdk/ui/focus'
import { OVERLAY_ENTER_EXIT, OVERLAY_SLIDE } from './overlay-motion'
import { MenuTrailingCheck } from './menu-row-parts'
import {
  MENU_CONTENT,
  MENU_DANGER_ITEM,
  MENU_ITEM,
  MENU_LABEL,
  MENU_SEPARATOR,
  MENU_SHORTCUT,
  MENU_TRAILING_INDICATOR,
  POPOVER_SURFACE,
} from './popover-surface'
import type { MenuItemTone } from './popover-surface'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuGroup = ContextMenuPrimitive.Group
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuSub = ContextMenuPrimitive.Sub
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(MENU_ITEM, 'data-[state=open]:bg-popover-hover', inset && 'pl-8', className)}
    {...props}
  >
    {children}
    <ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-text-faint" />
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, collisionPadding = 8, sideOffset = 2, alignOffset = -4, ...props }, ref) => (
  // Portalled for the same reason as the dropdown family's submenu: rendered inline it lands
  // inside the parent panel's scroll box and is clipped away. See `dropdown-menu.tsx`.
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      collisionPadding={collisionPadding}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      className={cn(
        POPOVER_SURFACE,
        MENU_CONTENT,
        OVERLAY_ENTER_EXIT,
        OVERLAY_SLIDE.near,
        'max-h-[var(--radix-context-menu-content-available-height)] origin-(--radix-context-menu-content-transform-origin)',
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

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

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
    tone?: MenuItemTone
  }
>(({ className, inset, tone = 'default', ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(MENU_ITEM, tone === 'danger' && MENU_DANGER_ITEM, inset && 'pl-8', className)}
    {...props}
  />
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

/** A multi-select row, check at the END like a `selected` row — see `DropdownMenuCheckboxItem`. */
const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem> & { inset?: boolean }
>(({ className, children, checked, inset, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(MENU_ITEM, inset && 'pl-8', className)}
    {...props}
  >
    {children}
    <MenuTrailingCheck selected={checked === true} />
  </ContextMenuPrimitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(MENU_ITEM, 'data-[state=checked]:font-medium', className)}
    {...props}
  >
    <span className="min-w-0 flex-1 truncate">{children}</span>
    <span className={MENU_TRAILING_INDICATOR}>
      <ContextMenuPrimitive.ItemIndicator>
        <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
  </ContextMenuPrimitive.RadioItem>
))
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(MENU_LABEL, inset && 'pl-8', className)}
    {...props}
  />
))
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn(MENU_SEPARATOR, className)} {...props} />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(MENU_SHORTCUT, className)} {...props} />
}
ContextMenuShortcut.displayName = 'ContextMenuShortcut'

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
}
