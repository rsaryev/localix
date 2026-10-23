import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { processSnapshotSchema, type ProcessSnapshot } from '../../shared/processes'
import { formatBytes } from '../../shared/system'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchFilterBar } from '@localixai/kit/workbench-filter-bar'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { useSystemProblem } from './useSystemProblem'
import { usePolledSnapshot } from '../usePolledSnapshot'
import {
  defaultProcessSort,
  nextProcessSort,
  sortProcesses,
  type ProcessSort,
  type ProcessSortKey,
} from './processSorting'

export function ProcessTable({
  active,
  onSnapshot,
}: {
  active: boolean
  onSnapshot?: (snapshot: ProcessSnapshot | null) => void
}) {
  const { snapshot, error, loading } = usePolledSnapshot({
    path: '/rpc/template/processes',
    schema: processSnapshotSchema,
    intervalMs: 5000,
    active,
    failureMessage: 'Cannot read processes right now.',
  })
  const problem = useSystemProblem({
    subject: 'Processes',
    failure: error,
    consequence: snapshot ? 'stale' : 'blocked',
  })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProcessSort>(defaultProcessSort)
  useEffect(() => onSnapshot?.(snapshot), [onSnapshot, snapshot])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sortProcesses(
      (snapshot?.processes ?? []).filter(
        (row) =>
          !needle || row.name.toLowerCase().includes(needle) || String(row.pid).includes(needle),
      ),
      sort,
    ).slice(0, 100)
  }, [snapshot, query, sort])
  const changeSort = (key: ProcessSortKey) => setSort((current) => nextProcessSort(current, key))
  return (
    <section
      aria-labelledby="processes-title"
      className="overflow-hidden rounded-lg border border-border"
    >
      <WorkbenchFilterBar aria-label="Process filters">
        <div className="min-w-0">
          <h2 id="processes-title" className="text-sm font-medium">
            Processes
          </h2>
          <p className="mt-0.5 text-xs text-text-faint">Current resource usage</p>
        </div>
        <SearchInput
          aria-label="Filter processes"
          value={query}
          onValueChange={setQuery}
          placeholder="Filter name or PID"
          size="md"
          className="w-full @lg:w-56 @lg:justify-self-end"
        />
      </WorkbenchFilterBar>
      {problem && <ProblemLine {...problem} className="border-b border-border-soft px-4 py-2" />}
      <div className="max-h-96 overflow-y-auto">
        {/* Fixed layout: the name column absorbs the width and truncates, the numeric
            columns keep their measure, and the PID column yields below `@md`. A
            min-width table scrolled sideways inside the dashboard instead. */}
        <table className="w-full table-fixed border-collapse text-left text-xs">
          <colgroup>
            <col />
            <col className="hidden w-20 @md:table-column" />
            <col className="w-20" />
            <col className="w-24" />
          </colgroup>
          {/* `lx-occluder`, not `bg-background`: that repaints the pane's own ground a second
              time, which the glass theme compounds into a slab; the occluder is the one recipe
              for a header that must hide what scrolls under it. */}
          <thead className="lx-occluder sticky top-0 z-(--z-sticky) text-text-faint">
            <tr className="border-b border-border">
              <SortHeader label="Process" sortKey="name" sort={sort} onSort={changeSort} />
              <SortHeader
                label="PID"
                sortKey="pid"
                sort={sort}
                onSort={changeSort}
                className="hidden @md:table-cell"
              />
              <SortHeader label="CPU" sortKey="cpu" sort={sort} onSort={changeSort} align="right" />
              <SortHeader
                label="Memory"
                sortKey="memory"
                sort={sort}
                onSort={changeSort}
                align="right"
                edge
              />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.pid}:${row.name}`}
                className="border-b border-border-faint last:border-0 hover:bg-surface-hover"
              >
                <td className="truncate px-4 py-2.5 font-medium" title={row.name}>
                  {row.name}
                </td>
                <td className="hidden px-3 py-2.5 font-mono tabular-nums text-text-soft @md:table-cell">
                  {row.pid}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {row.cpuPercent === null ? '—' : `${row.cpuPercent.toFixed(1)}%`}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {formatBytes(row.memoryBytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!snapshot && loading && (
          <div className="px-4 py-10 text-center text-xs text-text-faint">Reading processes…</div>
        )}
        {/* Only once there IS a list: before the first sample, or after a failed one, "No
            matching processes" claimed an empty machine beside the error that explained it. */}
        {snapshot && visible.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-text-faint">
            No matching processes.
          </div>
        )}
      </div>
    </section>
  )
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  edge = false,
  className = '',
}: {
  label: string
  sortKey: ProcessSortKey
  sort: ProcessSort
  onSort: (key: ProcessSortKey) => void
  align?: 'left' | 'right'
  edge?: boolean
  className?: string
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.direction === 'ascending' ? ArrowUp : ArrowDown
  return (
    <th
      aria-sort={active ? sort.direction : 'none'}
      className={`${edge ? 'px-4' : 'px-3 first:pl-4'} py-0 font-medium ${className}`}
    >
      {/* The kit's Button, not a native one: it brings the focus ring and the control height a
          hand-rolled header button had to remember, and did not. `px-0` keeps the label on the
          column's own edge. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSort(sortKey)}
        // `text-foreground`: the `text-text` this used is not a token, so the active column was
        // never highlighted at all.
        className={`w-full gap-1.5 px-0 font-medium hover:bg-transparent hover:text-foreground ${align === 'right' ? 'justify-end' : 'justify-start'} ${active ? 'text-foreground' : ''}`}
      >
        {label}
        <Icon className={`size-3 ${active ? 'opacity-100' : 'opacity-40'}`} aria-hidden="true" />
      </Button>
    </th>
  )
}
