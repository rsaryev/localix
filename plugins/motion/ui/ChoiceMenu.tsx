import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'

/**
 * A quiet trigger over a kit menu: a short label and a chevron, or an icon alone (the label is
 * then its accessible name and tooltip). `children` replaces the label's visible content.
 */
export function ChoiceMenu({
  label,
  entries,
  disabled = false,
  className,
  icon,
  children,
  align = 'start',
}: {
  label: string
  entries: MenuEntry[]
  disabled?: boolean
  className?: string
  icon?: ReactNode
  children?: ReactNode
  align?: 'start' | 'end'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {icon && !children ? (
          <IconButton
            size="sm"
            aria-label={label}
            tooltip={label}
            disabled={disabled}
            className={className}
          >
            {icon}
          </IconButton>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={children ? label : undefined}
            disabled={disabled}
            className={className}
          >
            {children ?? <span className="min-w-0 truncate">{label}</span>}
            <ChevronDown data-icon="inline-end" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
