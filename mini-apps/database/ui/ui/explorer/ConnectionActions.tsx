import { MoreHorizontal } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'

type Entries = readonly MenuEntry[] | (() => readonly MenuEntry[])

/**
 * The kebab behind a connection. `entries` may be a thunk: a tree row passes one so the menu is
 * described only when it OPENS — a row that built its menu on every render paid for it on every
 * store commit, for every connection, to open it perhaps once.
 */
export function ConnectionActions({
  displayName,
  entries,
  compact = false,
  tabIndex,
}: {
  displayName: string
  entries: Entries
  compact?: boolean
  tabIndex?: 0 | -1
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size={compact ? 'xs' : 'sm'}
          tabIndex={tabIndex}
          aria-label={`Actions for ${displayName}`}
          tooltip={`Actions for ${displayName}`}
          tooltipSide="bottom"
        >
          <MoreHorizontal className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <OpenedEntries entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Its own component so a thunk is called when the content mounts, i.e. when the menu opens. */
function OpenedEntries({ entries }: { entries: Entries }) {
  return (
    <MenuEntries entries={typeof entries === 'function' ? entries() : entries} family="dropdown" />
  )
}
