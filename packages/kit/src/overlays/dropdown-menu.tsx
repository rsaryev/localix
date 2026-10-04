'use client'

import * as React from 'react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
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

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(MENU_ITEM, 'data-[state=open]:bg-popover-hover', inset && 'pl-8', className)}
    {...props}
  >
    {children}
    <ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-text-faint" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, collisionPadding = 8, sideOffset = 2, alignOffset = -4, ...props }, ref) => (
  // PORTALLED, like the root content beside it. Unportalled, a submenu renders INSIDE the parent
  // panel — which is `overflow-y-auto overscroll-contain` — so it was clipped to the parent's box
  // and never appeared where the pointer expected it. That is one bug with two faces: the panel
  // that "does not show" and the one that opens on the wrong side, since a clipped element also
  // loses the collision measurements Radix flips on.
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      collisionPadding={collisionPadding}
      sideOffset={sideOffset}
      // A submenu reads as a continuation of its trigger, so its first row lines up with that row
      // rather than starting a panel's padding lower.
      alignOffset={alignOffset}
      className={cn(
        POPOVER_SURFACE,
        MENU_CONTENT,
        OVERLAY_ENTER_EXIT,
        OVERLAY_SLIDE.near,
        'max-h-[var(--radix-dropdown-menu-content-available-height)] origin-(--radix-dropdown-menu-content-transform-origin)',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => {
  const claimRef = useOverlayFocus('menu', ref)
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={claimRef}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // Material owned by POPOVER_SURFACE — the premium dark inset the model
          // selector / modes popover established, shared with Popover/ContextMenu
          // so a menu never reads as a lighter, out-of-place grey slab.
          POPOVER_SURFACE,
          // Stay within the viewport: cap height to the space Radix measures and
          // scroll instead of clipping (tall menus like multi-section filters used
          // to overflow off-screen). collisionPadding keeps it off the edges.
          MENU_CONTENT,
          OVERLAY_ENTER_EXIT,
          OVERLAY_SLIDE.far,
          'max-h-[var(--radix-dropdown-menu-content-available-height)] origin-(--radix-dropdown-menu-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
    tone?: MenuItemTone
  }
>(({ className, inset, tone = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(MENU_ITEM, tone === 'danger' && MENU_DANGER_ITEM, inset && 'pl-8', className)}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

/**
 * A multi-select row, drawn like a single-choice row: its check at the END.
 *
 * The defect it closes: the check sat in the leading slot an icon uses, so a checkbox row lost its
 * icon (status dots, priority marks, severities) while a `selected` row beside it kept its own.
 * Only the role tells the two apart now — `menuitemcheckbox` here, `menuitemradio` there.
 */
const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & { inset?: boolean }
>(({ className, children, checked, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(MENU_ITEM, inset && 'pl-8', className)}
    checked={checked}
    {...props}
  >
    {children}
    <MenuTrailingCheck selected={checked === true} />
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(MENU_ITEM, 'data-[state=checked]:font-medium', className)}
    {...props}
  >
    <span className="min-w-0 flex-1 truncate">{children}</span>
    <span className={MENU_TRAILING_INDICATOR}>
      <DropdownMenuPrimitive.ItemIndicator>
        <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(MENU_LABEL, inset && 'pl-8', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn(MENU_SEPARATOR, className)} {...props} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(MENU_SHORTCUT, className)} {...props} />
}
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut'

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
}
