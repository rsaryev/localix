import * as React from 'react'
import { Command as CommandPrimitive, useCommandState } from 'cmdk'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog'
import { InputGroup, InputGroupAddon } from '../controls/input-group'
import { MENU_SEPARATOR } from './popover-surface'
import { ResultCountStatus } from '@localixai/mini-app-sdk/ui/result-count-status'
import { Check, Search, type LucideIcon } from 'lucide-react'

const CommandLabelContext = React.createContext<string | undefined>(undefined)

function Command({ className, label, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  const dialogLabel = React.useContext(CommandLabelContext)

  return (
    <CommandPrimitive
      data-slot="command"
      // cmdk wires this label to its combobox input. Dialog palettes inherit
      // their visible-independent title; inline pickers retain a safe generic
      // name unless their composition supplies a more specific one.
      label={label ?? dialogLabel ?? 'Suggestions'}
      className={cn(
        // The host overlay (dialog / popover / drawer) owns the surface — Command
        // itself stays transparent so it never fights the family background.
        'flex size-full flex-col overflow-hidden rounded-xl bg-transparent p-1 text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        size="xl"
        layout="edge-to-edge"
        className={cn(
          // One palette shell for every quick pick: anchored high like an
          // editor quick-open, comfortably wide and viewport-clamped.
          'top-[22%] translate-y-0 overflow-hidden rounded-xl! p-0',
          className,
        )}
        showCloseButton={showCloseButton}
      >
        {/* Keep the accessible name inside the portalled content subtree. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <CommandLabelContext.Provider value={title}>{children}</CommandLabelContext.Provider>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  containerClassName,
  inputGroupClassName,
  icon: Icon = Search,
  trailing,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  icon?: LucideIcon
  /** Geometry for the input region when it is composed inside a toolbar. */
  containerClassName?: string
  /** Surface and density overrides for the shared input frame. */
  inputGroupClassName?: string
  /** A quiet control at the field's end (a scope picker). */
  trailing?: React.ReactNode
}) {
  const resultCount = useCommandState((state) => state.filtered.count)

  return (
    <>
      <div data-slot="command-input-wrapper" className={cn('min-w-0 p-1 pb-0', containerClassName)}>
        {/* Inside a CommandDialog the input grows into a roomier quick-open field;
            inline popover pickers (model select, comboboxes) keep the compact one. */}
        <InputGroup
          className={cn(
            // No fill override: it restated InputGroup's own 4% veil by hand, which meant this
            // field silently stopped tracking the shared `--field-fill` token.
            'h-[var(--chrome-control-lg)]! in-data-[slot=dialog-content]:h-[var(--chrome-control-touch)]!',
            inputGroupClassName,
          )}
        >
          <CommandPrimitive.Input
            data-slot="command-input"
            className={cn(
              'w-full text-xs/relaxed outline-hidden disabled:cursor-not-allowed disabled:opacity-50 in-data-[slot=dialog-content]:text-sm',
              className,
            )}
            {...props}
          />
          <InputGroupAddon>
            <Icon className="size-3.5 shrink-0 opacity-50 in-data-[slot=dialog-content]:size-4" />
          </InputGroupAddon>
          {trailing && <InputGroupAddon align="inline-end">{trailing}</InputGroupAddon>}
        </InputGroup>
      </div>
      {/* Keep status outside cmdk's role=listbox: only options/groups belong
          there. It is a polite, atomic visible-result count. */}
      <ResultCountStatus count={resultCount} data-slot="command-result-status" />
    </>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        // Dialog palettes get a taller, viewport-capped list; inline pickers
        // keep the compact default. Thin scrollbar = the canonical opt-in.
        // `clip`, not `hidden`: the palette list is inside a dialog, and the dialog contract is
        // vertical scrolling only. `hidden` still makes the box an x scroll container, which is
        // how a too-long command row became unreachable instead of wrapped.
        'scrollbar-thin max-h-72 scroll-py-1 overflow-x-clip overflow-y-auto outline-none in-data-[slot=dialog-content]:max-h-[min(24rem,55vh)]',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-8 text-center text-xs/relaxed text-text-soft', className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        // The group heading speaks MENU_LABEL's dialect (2xs, uppercase, faint) at this list's own
        // row inset, so a palette section and a dropdown section read as the same kind of thing.
        'overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:select-none **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-2xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-text-faint',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn(MENU_SEPARATOR, className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  showCheck = false,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & { showCheck?: boolean }) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-[var(--chrome-control-md)] cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-xs/relaxed outline-hidden select-none in-data-[slot=dialog-content]:min-h-[var(--chrome-control-lg)] in-data-[slot=dialog-content]:px-3 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-sidebar-accent data-selected:text-sidebar-foreground data-selected:shadow-(--shadow-raised) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-selected:*:[svg]:text-sidebar-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {showCheck && (
        <Check className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
      )}
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'ml-auto text-2xs tracking-widest text-text-soft group-data-selected/command-item:text-sidebar-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  // Hook export is intentional: consumers compose it with the Command primitive.
  // eslint-disable-next-line react-refresh/only-export-components
  useCommandState,
}
