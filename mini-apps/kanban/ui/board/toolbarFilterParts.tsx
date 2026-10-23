/**
 * THE FILTERS MENU'S ROWS — every facet but the search, which has its own field.
 *
 * The defect it replaces: the Filters popover was a stack of chip grids, one hand-laid group per
 * facet, so its spacing, its "on" state and its keyboard behaviour were its own rather than the
 * app's menus' (a pick is a menu, not a form). Now each facet is a submenu row of the
 * shared `MenuEntries`, its `hint` the current pick, so the closed level already reads as a summary.
 *
 * The rows follow what each facet IS:
 *   - Status, Priority, Labels and Origin select ANY of their values (OR within, AND across — see
 *     `useKanbanTaskFilter`), so they are `checked` toggles, `keepOpen` so a pick returns to the
 *     level whose hint just changed;
 *   - Agent is ONE assignee or none, so it is `selected` rows with an "Any agent" row for none.
 *
 * Every row calls the same toggle/set the chips did, so what a filter selects is unchanged.
 * `filterCount` is the facet count the trigger's chip shows; with any facet set, a final action
 * clears them all (search keeps its own field and its own clear).
 */
import { X } from 'lucide-react'
import type { IconComponent, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { monogramIcon } from '@localixai/kit/avatar'
import { StatusDot } from '@localixai/kit/status-dot'

import { KANBAN_ORIGINS, type KanbanStatus } from '../../shared/contracts'
import { KANBAN_STATUS_DOT } from '../model/kanbanStatus'
import { PRIORITY_BUCKETS, PRIORITY_PRESENTATION } from '../model/priorityPresentation'
import { COLUMNS } from './constants'
import type { KanbanFilters } from './useKanbanFilters'

/** The board's own labels list is capped here, as the chip grid capped it. */
const MAX_LABEL_ROWS = 16

/** A status's dot as a row icon, built once per status so a row's icon is stable across renders. */
const STATUS_ICON = Object.fromEntries(
  COLUMNS.map(({ status }): [KanbanStatus, IconComponent] => {
    const Dot = () => <StatusDot className={KANBAN_STATUS_DOT[status]} />
    Dot.displayName = `KanbanStatusDot(${status})`
    return [status, Dot]
  }),
) as Record<KanbanStatus, IconComponent>

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A multi-select facet's readout: "Any", the one pick, or how many. */
function pickHint(picked: readonly string[]): string {
  if (picked.length === 0) return 'Any'
  return picked.length === 1 ? picked[0]! : `${picked.length} selected`
}

/** One multi-select value: a toggle that returns to the facet row once flipped. */
const toggleRow = (
  id: string,
  label: string,
  checked: boolean,
  onSelect: () => void,
  icon?: IconComponent,
): MenuEntry => ({ id, label, icon, checked, keepOpen: true, onSelect })

export function filterMenuEntries(filters: KanbanFilters): MenuEntry[] {
  const statusTitle = (s: KanbanStatus) => COLUMNS.find((c) => c.status === s)?.title ?? s
  const facets: MenuEntry[] = [
    {
      id: 'status',
      label: 'Status',
      hint: pickHint([...filters.statusFilter].map(statusTitle)),
      items: COLUMNS.map(({ status, title }) =>
        toggleRow(
          `status:${status}`,
          title,
          filters.statusFilter.has(status),
          () => filters.toggleStatus(status),
          STATUS_ICON[status],
        ),
      ),
    },
    {
      id: 'priority',
      label: 'Priority',
      hint: pickHint([...filters.priorityFilter].map((p) => PRIORITY_PRESENTATION[p].label)),
      items: PRIORITY_BUCKETS.map((p) =>
        toggleRow(
          `priority:${p}`,
          PRIORITY_PRESENTATION[p].label,
          filters.priorityFilter.has(p),
          () => filters.togglePriority(p),
          PRIORITY_PRESENTATION[p].icon,
        ),
      ),
    },
  ]

  // Only once the board HAS labels: an always-present empty facet would advertise a filter with
  // nothing to pick.
  if (filters.labels.length > 0)
    facets.push({
      id: 'labels',
      label: 'Labels',
      hint: pickHint([...filters.labelFilter]),
      items: filters.labels
        .slice(0, MAX_LABEL_ROWS)
        .map((label) =>
          toggleRow(`label:${label}`, label, filters.labelFilter.has(label), () =>
            filters.toggleLabel(label),
          ),
        ),
    })

  facets.push({
    id: 'origin',
    label: 'Origin',
    hint: pickHint([...filters.originFilter].map(capitalize)),
    items: KANBAN_ORIGINS.map((o) =>
      toggleRow(`origin:${o}`, capitalize(o), filters.originFilter.has(o), () =>
        filters.toggleOrigin(o),
      ),
    ),
  })

  if (filters.assignees.length > 0) {
    const current = filters.assigneeFilter
    facets.push({
      id: 'agent',
      label: 'Agent',
      hint: current ? `@${current}` : 'Any',
      items: [
        {
          id: 'agent:any',
          label: 'Any agent',
          selected: current === '',
          keepOpen: true,
          onSelect: () => filters.setAssigneeFilter(''),
        },
        { separator: true },
        ...filters.assignees.map((a): MenuEntry => ({
          id: `agent:${a}`,
          label: `@${a}`,
          icon: monogramIcon(a, a),
          selected: current === a,
          keepOpen: true,
          // A radio row: choosing the current agent again keeps it. "Any agent" is the way back
          // to none, which the chip's second click used to be.
          onSelect: () => filters.setAssigneeFilter(a),
        })),
      ],
    })
  }

  if (filters.filterCount === 0) return facets
  return [
    ...facets,
    { separator: true },
    { id: 'clear', label: 'Clear filters', icon: X, onSelect: filters.clearAdvancedFilters },
  ]
}
