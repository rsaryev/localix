'use client'

import * as React from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Popover, PopoverAnchor, PopoverContent } from '../overlays/popover'
import { MENU_ITEM } from '../overlays/popover-surface'

function Autocomplete(props: React.ComponentProps<typeof Popover>) {
  return <Popover {...props} />
}

function AutocompleteAnchor(props: React.ComponentProps<typeof PopoverAnchor>) {
  return <PopoverAnchor {...props} />
}

type AccessibleListboxName =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-label'?: never; 'aria-labelledby': string }

type AutocompleteListProps = Omit<
  React.ComponentProps<typeof PopoverContent>,
  'aria-label' | 'aria-labelledby' | 'layout' | 'role'
> &
  AccessibleListboxName

type AutocompletePanelProps = Omit<React.ComponentProps<typeof PopoverContent>, 'layout' | 'role'>

/**
 * Rich completion popup with pinned chrome around one caller-declared scroll region.
 * Use this when a completion surface needs filters, notices, or grouped options;
 * use `AutocompleteList` for the simple listbox-only case.
 */
const AutocompletePanel = React.forwardRef<
  React.ElementRef<typeof PopoverContent>,
  AutocompletePanelProps
>(
  (
    {
      className,
      align = 'start',
      side = 'bottom',
      onOpenAutoFocus,
      onCloseAutoFocus,
      onMouseDown,
      ...props
    },
    ref,
  ) => (
    <PopoverContent
      ref={ref}
      data-slot="autocomplete-panel"
      layout="structured"
      align={align}
      side={side}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        // Virtual focus remains on the owning editable control.
        event.preventDefault()
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        // An outside click owns its next focus target; never pull it back.
        event.preventDefault()
      }}
      onMouseDown={(event) => {
        // Header controls and options remain clickable without blurring the editor.
        event.preventDefault()
        onMouseDown?.(event)
      }}
      className={cn(
        'max-h-[min(50vh,22rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)]',
        className,
      )}
      {...props}
    />
  ),
)
AutocompletePanel.displayName = 'AutocompletePanel'

const AutocompleteHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="autocomplete-header"
      className={cn('shrink-0 border-b border-control-border/60 p-1', className)}
      {...props}
    />
  ),
)
AutocompleteHeader.displayName = 'AutocompleteHeader'

/** The one scrolling region in a rich completion popup. */
const AutocompleteBody = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="autocomplete-body"
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-1 scrollbar-thin',
        className,
      )}
      {...props}
    />
  ),
)
AutocompleteBody.displayName = 'AutocompleteBody'

type AutocompleteOptionsProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'role'
> &
  AccessibleListboxName

const AutocompleteOptions = React.forwardRef<HTMLDivElement, AutocompleteOptionsProps>(
  (props, ref) => (
    <div
      ref={ref}
      data-slot="autocomplete-options"
      role="listbox"
      aria-orientation="vertical"
      {...props}
    />
  ),
)
AutocompleteOptions.displayName = 'AutocompleteOptions'

/**
 * Portalled, collision-aware popup for editable-input completions.
 *
 * DOM focus intentionally stays on the owning combobox input; callers expose
 * the visual row through `aria-activedescendant`.
 */
const AutocompleteList = React.forwardRef<
  React.ElementRef<typeof PopoverContent>,
  AutocompleteListProps
>(
  (
    { className, align = 'start', side = 'bottom', onOpenAutoFocus, onCloseAutoFocus, ...props },
    ref,
  ) => (
    <PopoverContent
      ref={ref}
      data-slot="autocomplete-list"
      layout="freeform"
      role="listbox"
      aria-orientation="vertical"
      align={align}
      side={side}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        // This is an aria-activedescendant listbox, not a focus-moving menu.
        event.preventDefault()
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        // Dismissal must preserve the user's next focus target, not restore the input.
        event.preventDefault()
      }}
      className={cn(
        'max-h-[min(16rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] gap-0 p-1',
        className,
      )}
      {...props}
    />
  ),
)
AutocompleteList.displayName = 'AutocompleteList'

type AutocompleteOptionProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'aria-selected' | 'role' | 'tabIndex' | 'type'
> & {
  active: boolean
  /** Alternate active-row recipe for richer editor surfaces. */
  activeClassName?: string
}

/** A visually active option whose DOM focus remains on the combobox input. */
const AutocompleteOption = React.forwardRef<HTMLButtonElement, AutocompleteOptionProps>(
  ({ active, activeClassName = 'bg-surface-hover', className, onMouseDown, ...props }, ref) => (
    <button
      ref={ref}
      data-slot="autocomplete-option"
      data-active={active}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      className={cn(MENU_ITEM, 'w-full', active && activeClassName, className)}
      onMouseDown={(event) => {
        // Prevent the browser's button-focus default; click still commits the option.
        event.preventDefault()
        onMouseDown?.(event)
      }}
      {...props}
    />
  ),
)
AutocompleteOption.displayName = 'AutocompleteOption'

export {
  Autocomplete,
  AutocompleteAnchor,
  AutocompleteBody,
  AutocompleteHeader,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteOptions,
  AutocompletePanel,
}
export type {
  AutocompleteListProps,
  AutocompleteOptionProps,
  AutocompleteOptionsProps,
  AutocompletePanelProps,
}
