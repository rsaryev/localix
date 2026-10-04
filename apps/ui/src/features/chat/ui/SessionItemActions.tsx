import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { EllipsisVertical } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'

interface SessionItemActionsProps {
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  entries: readonly MenuEntry[]
}

/** One predictable action slot at any sidebar width; pin and archive live in the menu. */
export function SessionItemActions({
  menuOpen,
  onMenuOpenChange,
  entries,
}: SessionItemActionsProps) {
  return (
    <div className="flex shrink-0 items-center">
      <DropdownMenu onOpenChange={onMenuOpenChange} open={menuOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" surface="sidebar" aria-label="Conversation actions">
            <EllipsisVertical className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[190px]">
          <MenuEntries entries={entries} family="dropdown" />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
