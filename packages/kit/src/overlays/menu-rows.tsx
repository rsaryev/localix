'use client'

import * as React from 'react'
import type { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { OVERLAY_ENTER_EXIT, OVERLAY_SLIDE } from './overlay-motion'
import { MenuTrailingCheck } from './menu-row-parts'
import {
  MENU_CONTENT,
  MENU_DANGER_ITEM,
  MENU_ITEM,
  MENU_LABEL,
  MENU_SEPARATOR,
  POPOVER_SURFACE,
} from './popover-surface'
import type { MenuItemTone } from './popover-surface'

/**
 * The rows the dropdown and context menu families draw alike.
 *
 * Radix builds both families on one menu primitive, so each row's props are the same in both and
 * only the namespace that renders it differs. The family passes its namespace and gets the rows.
 */

type RowPart = 'Item' | 'CheckboxItem' | 'Label' | 'Separator' | 'SubTrigger' | 'SubContent'
type Part<K extends RowPart> = React.ComponentPropsWithoutRef<(typeof DropdownMenuPrimitive)[K]>
type Primitive<P> = React.ForwardRefExoticComponent<P & React.RefAttributes<HTMLDivElement>>

/** The parts of a Radix menu namespace the rows render with. */
export interface MenuRowPrimitives {
  Portal: React.FC<{ children?: React.ReactNode }>
  Item: Primitive<Part<'Item'>>
  CheckboxItem: Primitive<Part<'CheckboxItem'>>
  Label: Primitive<Part<'Label'>>
  Separator: Primitive<Part<'Separator'>>
  SubTrigger: Primitive<Part<'SubTrigger'>>
  SubContent: Primitive<Part<'SubContent'>>
}

/**
 * @param subContentClass the family's own height cap and transform origin, written out in full so
 *   Tailwind finds the class in the source.
 */
export function createMenuRows(P: MenuRowPrimitives, subContentClass: string) {
  const SubTrigger = React.forwardRef<
    HTMLDivElement,
    Part<'SubTrigger'> & {
      inset?: boolean
    }
  >(({ className, inset, children, ...props }, ref) => (
    <P.SubTrigger
      ref={ref}
      className={cn(MENU_ITEM, 'data-[state=open]:bg-popover-hover', inset && 'pl-8', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-text-faint" />
    </P.SubTrigger>
  ))
  SubTrigger.displayName = P.SubTrigger.displayName

  const SubContent = React.forwardRef<HTMLDivElement, Part<'SubContent'>>(
    ({ className, collisionPadding = 8, sideOffset = 2, alignOffset = -4, ...props }, ref) => (
      // PORTALLED, like the root content beside it. Unportalled, a submenu renders INSIDE the
      // parent panel — which is `overflow-y-auto overscroll-contain` — so it was clipped to the
      // parent's box and never appeared where the pointer expected it. That is one bug with two
      // faces: the panel that "does not show" and the one that opens on the wrong side, since a
      // clipped element also loses the collision measurements Radix flips on.
      <P.Portal>
        <P.SubContent
          ref={ref}
          collisionPadding={collisionPadding}
          sideOffset={sideOffset}
          // A submenu reads as a continuation of its trigger, so its first row lines up with that
          // row rather than starting a panel's padding lower.
          alignOffset={alignOffset}
          className={cn(
            POPOVER_SURFACE,
            MENU_CONTENT,
            OVERLAY_ENTER_EXIT,
            OVERLAY_SLIDE.near,
            subContentClass,
            className,
          )}
          {...props}
        />
      </P.Portal>
    ),
  )
  SubContent.displayName = P.SubContent.displayName

  const Item = React.forwardRef<
    HTMLDivElement,
    Part<'Item'> & {
      inset?: boolean
      tone?: MenuItemTone
    }
  >(({ className, inset, tone = 'default', ...props }, ref) => (
    <P.Item
      ref={ref}
      className={cn(MENU_ITEM, tone === 'danger' && MENU_DANGER_ITEM, inset && 'pl-8', className)}
      {...props}
    />
  ))
  Item.displayName = P.Item.displayName

  /**
   * A multi-select row, drawn like a single-choice row: its check at the END.
   *
   * The defect it closes: the check sat in the leading slot an icon uses, so a checkbox row lost
   * its icon (status dots, priority marks, severities) while a `selected` row beside it kept its
   * own. Only the role tells the two apart now — `menuitemcheckbox` here, `menuitemradio` there.
   */
  const CheckboxItem = React.forwardRef<HTMLDivElement, Part<'CheckboxItem'> & { inset?: boolean }>(
    ({ className, children, checked, inset, ...props }, ref) => (
      <P.CheckboxItem
        ref={ref}
        className={cn(MENU_ITEM, inset && 'pl-8', className)}
        checked={checked}
        {...props}
      >
        {children}
        <MenuTrailingCheck selected={checked === true} />
      </P.CheckboxItem>
    ),
  )
  CheckboxItem.displayName = P.CheckboxItem.displayName

  const Label = React.forwardRef<HTMLDivElement, Part<'Label'> & { inset?: boolean }>(
    ({ className, inset, ...props }, ref) => (
      <P.Label ref={ref} className={cn(MENU_LABEL, inset && 'pl-8', className)} {...props} />
    ),
  )
  Label.displayName = P.Label.displayName

  const Separator = React.forwardRef<HTMLDivElement, Part<'Separator'>>(
    ({ className, ...props }, ref) => (
      <P.Separator ref={ref} className={cn(MENU_SEPARATOR, className)} {...props} />
    ),
  )
  Separator.displayName = P.Separator.displayName

  return { SubTrigger, SubContent, Item, CheckboxItem, Label, Separator }
}
