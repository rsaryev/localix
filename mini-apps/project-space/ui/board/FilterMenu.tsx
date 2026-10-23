import { ListFilter } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { SpaceDocument } from '../../shared/format/document'
import { spaceTypes } from '../../shared/types'
import { viewOf } from '../elements'

/**
 * The selection narrowed to one kind, as the whiteboards' filter: drag over a busy area, then keep
 * only its notes to recolour them, or only its shapes to align them. Offered when the selection
 * mixes kinds; each row says how many it keeps.
 */
export function selectionKinds(space: SpaceDocument, ids: readonly string[]) {
  const kinds = new Map<string, string[]>()
  for (const id of ids) {
    const type = space.elements[id]?.type
    if (type) kinds.set(type, [...(kinds.get(type) ?? []), id])
  }
  return kinds
}

export function FilterMenu({
  space,
  ids,
  select,
}: {
  space: SpaceDocument
  ids: readonly string[]
  select: (ids: readonly string[]) => void
}) {
  const kinds = selectionKinds(space, ids)
  if (kinds.size < 2) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label="Filter the selection" tooltip="Filter the selection">
          <ListFilter className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44">
        <MenuEntries
          family="dropdown"
          entries={[...kinds].map(([type, members]) => ({
            id: type,
            label: spaceTypes.get(type)?.label ?? type,
            icon: viewOf(type)?.Icon,
            hint: String(members.length),
            onSelect: () => select(members),
          }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
