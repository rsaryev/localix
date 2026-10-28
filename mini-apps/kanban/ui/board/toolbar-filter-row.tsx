import { BarChart3, Filter, Rows2, Rows3, SquareKanban, X } from 'lucide-react'
import {
  SegmentedRadioGroup,
  type SegmentedRadioOption,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { Button } from '@localixai/kit/button'
import { Chip } from '@localixai/kit/chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { SearchInput } from '@localixai/kit/search-input'

import { COLUMNS } from './constants'
import { filterMenuEntries } from './toolbarFilterParts'
import type { BoardView } from './types'
import { useBoardDensity } from './useBoardDensity'
import type { KanbanFilters } from './useKanbanFilters'

const VIEW_OPTIONS: ReadonlyArray<SegmentedRadioOption<BoardView>> = [
  {
    value: 'board',
    title: 'Board',
    'aria-label': 'Board view',
    label: (
      <>
        <SquareKanban className="size-3.5 shrink-0" />
        <span className="hidden @lg:inline">Board</span>
      </>
    ),
  },
  {
    value: 'stats',
    title: 'Stats',
    'aria-label': 'Stats view',
    label: (
      <>
        <BarChart3 className="size-3.5 shrink-0" />
        <span className="hidden @lg:inline">Stats</span>
      </>
    ),
  },
]

interface ActiveChip {
  key: string
  group: string
  label: string
  onClear: () => void
}

/** Every active filter as a removable chip — each clears just itself. */
function activeChips(filters: KanbanFilters): ActiveChip[] {
  const statusTitle = (s: string) => COLUMNS.find((c) => c.status === s)?.title ?? s
  const chips: ActiveChip[] = []
  const search = filters.search.trim()
  if (search)
    chips.push({
      key: 'search',
      group: 'Search',
      label: search,
      onClear: () => filters.setSearch(''),
    })
  for (const s of filters.statusFilter)
    chips.push({
      key: `st-${s}`,
      group: 'Status',
      label: statusTitle(s),
      onClear: () => filters.toggleStatus(s),
    })
  for (const o of filters.originFilter)
    chips.push({
      key: `or-${o}`,
      group: 'Origin',
      label: o,
      onClear: () => filters.toggleOrigin(o),
    })
  for (const p of filters.priorityFilter)
    chips.push({
      key: `pr-${p}`,
      group: 'Priority',
      label: p,
      onClear: () => filters.togglePriority(p),
    })
  for (const label of filters.labelFilter)
    chips.push({
      key: `lb-${label}`,
      group: 'Label',
      label,
      onClear: () => filters.toggleLabel(label),
    })
  if (filters.assigneeFilter)
    chips.push({
      key: 'agent',
      group: 'Agent',
      label: `@${filters.assigneeFilter}`,
      onClear: () => filters.setAssigneeFilter(''),
    })
  return chips
}

/** Search and facet filters, the density toggle, the board↔stats switch and the chip strip. */
export function KanbanFilterRow({
  view,
  onViewChange,
  filters,
}: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  filters: KanbanFilters
}) {
  const [density, toggleDensity] = useBoardDensity()
  const compact = density === 'compact'
  const advancedCount = filters.filterCount
  const chips = activeChips(filters)

  return (
    <>
      {/* One rung for the whole toolbar: `md` (28px), the one every stacked search + filter toolbar
          in the product uses, and the one the create row above is fixed at. This row used to sit on
          `lg` (32px) under a 28px create row, so the two rows never lined up. Control labels
          collapse to icons on a narrow panel (@container). */}
      <div
        role="group"
        aria-label="Task filters"
        className="grid min-w-0 grid-cols-1 items-center gap-1.5 @xl:grid-cols-[minmax(0,1fr)_auto]"
      >
        <SearchInput
          size="md"
          value={filters.search}
          onValueChange={filters.setSearch}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="w-full"
        />

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Quiet like its neighbours; open, it takes the kit's `aria-expanded` step, and the
                count chip says a filter is on — not a hand-tinted border that read as focus. */}
              <Button variant="ghost" title="Filters">
                <Filter className="size-3.5 shrink-0" />
                <span className="hidden @lg:inline">Filters</span>
                {advancedCount > 0 && (
                  <Chip tone="info" size="dense">
                    {advancedCount}
                  </Chip>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <MenuEntries entries={filterMenuEntries(filters)} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>

          {filters.filtersActive && (
            <Button
              variant="ghost"
              onClick={filters.resetFilters}
              title="Reset search and filters"
              aria-label="Reset search and filters"
              className="text-text-faint"
            >
              <X className="size-3 shrink-0" /> <span className="hidden @lg:inline">Reset</span>
            </Button>
          )}

          {view === 'board' && (
            // The kit's pressed toggle: IconButton styles `aria-pressed` itself.
            <IconButton
              onClick={toggleDensity}
              tooltip={compact ? 'Comfortable card density' : 'Compact card density'}
              aria-label={
                compact ? 'Switch to comfortable card density' : 'Switch to compact card density'
              }
              aria-pressed={compact}
              className="shrink-0"
            >
              {compact ? (
                <Rows2 className="size-3.5 shrink-0" />
              ) : (
                <Rows3 className="size-3.5 shrink-0" />
              )}
            </IconButton>
          )}

          <SegmentedRadioGroup
            aria-label="Kanban view"
            variant="muted"
            value={view}
            onValueChange={onViewChange}
            options={VIEW_OPTIONS}
            className="shrink-0"
          />
        </div>
      </div>

      {chips.length > 0 && (
        <div
          role="group"
          aria-label="Active filters"
          className="flex flex-wrap items-center gap-1.5"
        >
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="ghost"
              size="sm"
              onClick={chip.onClear}
              // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than
              // the toolbar, so the active-filter chips read as a row of black pills.
              className="max-w-[14rem] border-control-border/55 bg-foreground/[0.04] text-2xs text-text-soft hover:border-status-error/50"
              title={`Remove filter: ${chip.label}`}
              aria-label={`Remove ${chip.group} filter: ${chip.label}`}
            >
              <span className="text-text-faint">{chip.group}</span>
              <span className="truncate font-medium">{chip.label}</span>
              <X className="size-2.5 shrink-0 text-text-faint" />
            </Button>
          ))}
        </div>
      )}
    </>
  )
}
