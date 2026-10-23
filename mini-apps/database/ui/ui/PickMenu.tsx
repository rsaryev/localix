import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

/**
 * A PICK IN A HEADER — the current value as quiet text and a chevron, the choices as menu rows.
 *
 * The database views picked a schema, a connection and a chart setting with framed `Select`
 * fields: form controls in a header, each squeezed to the row with its own height override and
 * each out-shouting the content it configured. The app's pick is the shared menu, not a form
 * field, so every header pick here is this one trigger over `MenuEntries`
 * — the rows a caller builds are `selected`, so the current choice keeps its icon and gets the ✓.
 */
export function PickMenu({
  label,
  'aria-label': ariaLabel,
  entries,
  size = 'default',
  align = 'end',
  className,
}: {
  /** What the trigger reads — the current value, or the menu's name. */
  label: ReactNode
  'aria-label': string
  entries: readonly MenuEntry[]
  /** The row's own rung: `xs` in a 20px console bar, `default` (28) in a toolbar. */
  size?: 'xs' | 'sm' | 'default'
  align?: 'start' | 'end'
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={ariaLabel}
          className={cn('min-w-0 font-normal text-text-soft', className)}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown data-icon="inline-end" className="opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
