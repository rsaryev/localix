import type { ComponentType, ReactNode, Ref } from 'react'
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from './context-menu'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './dropdown-menu'
import type { MenuItemTone } from './popover-surface'

/**
 * The two Radix menu families as DATA, for the one walker in `menu-entries.tsx`.
 *
 * Radix ships `ContextMenu*` and `DropdownMenu*` as separate component sets; rendering a described
 * menu into each with its own walker is how the two drifted (see `MenuEntries`). Naming the slice
 * of props the walker sets, once, is what lets a new entry kind reach both families at once — a
 * prop added here that one family lacks fails `tsc` instead of silently missing in a context menu.
 */
export type MenuFamilyName = 'context' | 'dropdown'

/** The slice of each family's props the walker sets — deliberately smaller than Radix's surface. */
export interface MenuFamily {
  Item: ComponentType<{
    children?: ReactNode
    className?: string
    disabled?: boolean
    inset?: boolean
    tone?: MenuItemTone
    onSelect?: (event: Event) => void
    /** `menuitemradio` for a `selected` row: Radix spreads it over its own `menuitem`. */
    role?: 'menuitemradio'
    'aria-checked'?: boolean
    /** Set on a `recommended` row, beside the travelling accent it carries. */
    'data-recommended'?: boolean
  }>
  CheckboxItem: ComponentType<{
    children?: ReactNode
    checked?: boolean
    inset?: boolean
    disabled?: boolean
    onSelect?: (event: Event) => void
  }>
  Label: ComponentType<{ children?: ReactNode }>
  Separator: ComponentType<{ className?: string }>
  Sub: ComponentType<{
    children?: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }>
  SubTrigger: ComponentType<{
    children?: ReactNode
    disabled?: boolean
    inset?: boolean
    ref?: Ref<HTMLDivElement>
  }>
  SubContent: ComponentType<{ children?: ReactNode }>
}

export const MENU_FAMILIES: Record<MenuFamilyName, MenuFamily> = {
  context: {
    Item: ContextMenuItem,
    CheckboxItem: ContextMenuCheckboxItem,
    Label: ContextMenuLabel,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
  },
  dropdown: {
    Item: DropdownMenuItem,
    CheckboxItem: DropdownMenuCheckboxItem,
    Label: DropdownMenuLabel,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
  },
}
