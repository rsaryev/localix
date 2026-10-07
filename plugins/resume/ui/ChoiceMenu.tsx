import { ChevronDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'

export function ChoiceMenu({
  label,
  entries,
  disabled = false,
}: {
  label: string
  entries: MenuEntry[]
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          {label}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
