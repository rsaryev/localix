import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn, CONTROL_FOCUS_VISIBLE } from '@localixai/plugin-sdk/ui/classes'

/** A visual option whose preview matters to the choice; ordinary short choices use a menu. */
export const SelectionTile = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { selected?: boolean }
>(function SelectionTile({ selected = false, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      data-slot="selection-tile"
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-md border p-2 text-left text-xs transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'border-foreground bg-surface-active' : 'border-border',
        CONTROL_FOCUS_VISIBLE,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})
