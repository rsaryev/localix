import { Replace } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { viewOf } from '../elements'
import { isSwitchable, SWITCHABLE, switchTypeOps } from './switchType'

/** "Switch type" on the bar: one icon, the kinds an element can become (`switchType.ts`). */
export function SwitchTypeMenu({
  space,
  id,
  commit,
}: {
  space: SpaceDocument
  id: string
  commit: (ops: readonly SpaceOp[]) => void
}) {
  const element = space.elements[id]
  if (!element || element.locked || !isSwitchable(element.type)) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label="Switch type" tooltip="Switch type">
          <Replace className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-40">
        <MenuEntries
          family="dropdown"
          entries={SWITCHABLE.map((type) => ({
            id: type,
            label: spaceTypes.get(type)?.label ?? type,
            icon: viewOf(type)?.Icon,
            selected: element.type === type,
            onSelect: () => {
              const ops = switchTypeOps(space, id, type)
              if (ops) commit(ops)
            },
          }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
