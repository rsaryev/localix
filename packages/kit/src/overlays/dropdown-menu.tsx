'use client'

import * as React from 'react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/plugin-sdk/ui/focus'
import { OVERLAY_ENTER_EXIT, OVERLAY_SLIDE } from './overlay-motion'
import { createMenuRows } from './menu-rows'
import {
  MENU_CONTENT,
  MENU_ITEM,
  MENU_SHORTCUT,
  MENU_TRAILING_INDICATOR,
  POPOVER_SURFACE,
} from './popover-surface'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const rows = createMenuRows(
  DropdownMenuPrimitive,
  'max-h-[var(--radix-dropdown-menu-content-available-height)] origin-(--radix-dropdown-menu-content-transform-origin)',
)
const DropdownMenuSubTrigger = rows.SubTrigger
const DropdownMenuSubContent = rows.SubContent

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    /** Prevent autofocus when a menu is previewed by hovering its trigger. */
    onOpenAutoFocus?: (event: Event) => void
  }
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

const DropdownMenuItem = rows.Item
/** A multi-select row, its check at the END like a `selected` row — see `createMenuRows`. */
const DropdownMenuCheckboxItem = rows.CheckboxItem

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

const DropdownMenuLabel = rows.Label
const DropdownMenuSeparator = rows.Separator

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
