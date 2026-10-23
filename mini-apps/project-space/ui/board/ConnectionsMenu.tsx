import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowLeftRight, ArrowUpLeft, Waypoints } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { SpaceDocument } from '../../shared/format/document'
import type { Link } from '../../shared/graph/links'
import { elementName } from '../../shared/graph/names'
import { reachCounts, type ReachDirection } from '../../shared/graph/reach'
import { spaceTypes } from '../../shared/types'
import type { BoardReading } from './useReading'

/**
 * One element's connections, in its selection bar: where its arrows lead, where they come from,
 * and the two traces — the one card that answers "what is this joined to?", kept inside the bar
 * the element already has instead of a panel of its own.
 *
 * Every connection is a way to its other end: choosing one takes the camera there. A trace with
 * nothing on its side is left out, not greyed, like every other item the bar cannot do.
 */
const WAYS: readonly { way: Link['way']; title: string; Icon: LucideIcon }[] = [
  { way: 'out', title: 'Leads to', Icon: ArrowDownRight },
  { way: 'in', title: 'Comes from', Icon: ArrowUpLeft },
  { way: 'both', title: 'Joined with', Icon: ArrowLeftRight },
]
const LISTED = 12

export function ConnectionsMenu({
  space,
  id,
  reading,
  focus,
}: {
  space: SpaceDocument
  id: string
  reading: BoardReading
  focus: (ids: readonly string[]) => void
}) {
  const links = reading.links.get(id) ?? []
  if (links.length === 0) return null
  const counts = reachCounts(space, id, reading.links)
  const traced = reading.trace?.origin === id ? reading.trace.direction : null
  const traces: readonly { direction: ReachDirection; label: string; count: number }[] = [
    { direction: 'upstream', label: 'Trace upstream', count: counts.upstream },
    { direction: 'downstream', label: 'Trace downstream', count: counts.downstream },
  ]
  // The trace on view is ONE of the two directions (choosing it again clears it), so the traces
  // are `selected` rows — the menu's trailing check, not one placed by hand beside the count.
  const traceRows: MenuEntry[] = traces
    .filter((trace) => trace.count > 0)
    .map((trace) => ({
      id: `trace:${trace.direction}`,
      label: trace.label,
      icon: trace.direction === 'upstream' ? ArrowUpLeft : ArrowDownRight,
      hint: `${trace.count} element${trace.count === 1 ? '' : 's'}`,
      selected: traced === trace.direction,
      onSelect: () => reading.toggleTrace(id, trace.direction),
    }))
  const wayRows = WAYS.flatMap(({ way, title, Icon }): MenuEntry[] => {
    const group = links.filter((link) => link.way === way)
    if (group.length === 0) return []
    return [
      { separator: true },
      { header: `${title} · ${group.length}` },
      ...group.slice(0, LISTED).map((link) => ({
        id: `link:${link.edge}`,
        label: elementName(space, spaceTypes, link.other),
        icon: Icon,
        ...(link.label ? { hint: link.label } : {}),
        onSelect: () => focus([link.other]),
      })),
      ...(group.length > LISTED
        ? [
            {
              id: `more:${way}`,
              label: `and ${group.length - LISTED} more — trace to see them all`,
              disabled: true,
              onSelect: () => {},
            },
          ]
        : []),
    ]
  })
  const entries: MenuEntry[] = [...traceRows, ...wayRows]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-1.5 tabular-nums"
          aria-label={`Connections: ${links.length}`}
          title="Connections"
        >
          <Waypoints className="size-3.5" />
          {links.length}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <MenuEntries family="dropdown" entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
