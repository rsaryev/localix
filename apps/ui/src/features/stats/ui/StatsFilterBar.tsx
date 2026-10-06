/**
 * The dashboard's one control bar: what period, what the breakdown groups by, and which
 * subset of the ledger is in view.
 *
 * Four filters did not fit a row of framed selects: they crowded a narrow inspector pane and
 * then took a reflowing grid of their own — a form where nothing is saved. A narrowing is a
 * pick, so the bar states the QUESTION (range, grouping) as two view toggles and puts every
 * NARROWING behind one quiet "Filter" menu on the same line: a submenu per dimension whose hint
 * is the current answer. A model or agent list can be long; it scrolls inside its submenu.
 *
 * Active filters also repeat as removable chips. A menu shows its answers only when opened,
 * which is how a forgotten filter turns into "the numbers are wrong"; the chips say what is
 * excluded in full words, and each removes only itself, so undoing one narrowing does not
 * discard the other three.
 */
import { ActiveFilterChips } from '@/shared/ui/ActiveFilterChips'
import { Segmented } from '@localixai/plugin-sdk/ui/segmented-control'
import type { UsageFilters, UsageGroupBy, UsageRange } from '@/shared/hooks/useUsageStats'
import { FilterMenu, type FilterFacet } from '@/shared/ui/FilterMenu'

export interface FilterField {
  /** The `UsageFilters` key this control writes. */
  id: keyof UsageFilters
  label: string
  options: { value: string; label: string }[]
}

const RANGES: { id: UsageRange; label: string }[] = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
]

const GROUPS: { id: UsageGroupBy; label: string }[] = [
  { id: 'model', label: 'Model' },
  { id: 'provider', label: 'Provider' },
  { id: 'agent', label: 'Agent' },
  { id: 'kind', label: 'Kind' },
]

export function StatsFilterBar({
  range,
  onRange,
  groupBy,
  onGroupBy,
  filters,
  onFilter,
  onClear,
  fields,
}: {
  range: UsageRange
  onRange: (r: UsageRange) => void
  groupBy: UsageGroupBy
  onGroupBy: (g: UsageGroupBy) => void
  filters: UsageFilters
  onFilter: (key: keyof UsageFilters, value: string) => void
  onClear: () => void
  fields: FilterField[]
}) {
  // A chip needs the option's LABEL, not the stored id: a filter set by clicking a breakdown
  // row holds a model id or an agent id, and "builtin:qa" is not what the reader chose.
  const active = fields.flatMap((field) => {
    const value = filters[field.id]
    if (!value) return []
    const label = field.options.find((o) => o.value === value)?.label ?? value
    return [{ id: field.id, field: field.label, label }]
  })
  // `''` is "every one": the ledger is not narrowed by this field.
  const facets: FilterFacet[] = fields.map((field) => ({
    id: field.id,
    label: field.label,
    value: filters[field.id] ?? '',
    allValue: '',
    options: [{ value: '', label: `All ${field.label.toLowerCase()}s` }, ...field.options],
    onChange: (value) => onFilter(field.id, value),
  }))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="Time range"
          className="w-max shrink-0"
          options={RANGES}
          value={range}
          onChange={onRange}
        />
        <Segmented
          aria-label="Group usage by"
          className="w-max shrink-0"
          options={GROUPS}
          value={groupBy}
          onChange={onGroupBy}
        />
        {facets.length > 0 && (
          <FilterMenu label="Filter usage" className="ml-auto" facets={facets} />
        )}
      </div>
      <ActiveFilterChips chips={active} onRemove={(id) => onFilter(id, '')} onClear={onClear} />
    </div>
  )
}
