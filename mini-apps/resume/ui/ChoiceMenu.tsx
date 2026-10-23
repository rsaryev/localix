import type { ReactNode } from 'react'
import { IconButton } from '@localixai/kit/icon-button'
import { ChevronDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'

export function ChoiceMenu({
  label,
  entries,
  disabled = false,
  className,
  icon,
}: {
  label: string
  entries: MenuEntry[]
  disabled?: boolean
  className?: string
  icon?: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {icon ? (
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
          <Button variant="ghost" size="sm" disabled={disabled} className={className}>
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
