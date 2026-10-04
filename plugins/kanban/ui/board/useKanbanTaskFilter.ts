import { useCallback, useMemo } from 'react'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { priorityBucket, type PriorityBucket } from '../model/priorityPresentation'
import { boardLabels } from '../model/useBoard'
import type { OriginFilter } from './types'

/**
 * WHAT THE FILTERS SELECT — the pure derivation from (cards × filter bag) to the lists the board
 * and the stats view render.
 *
 * Separate from `useKanbanFilters`, which owns WHAT THE FILTERS ARE (the facet state and its
 * survival across a remount); this half holds no state at all — same cards and same filters in,
 * same lists out.
 *
 * The two rules worth knowing before changing anything here: status is deliberately EXCLUDED from
 * `matchesFacets` so each consumer applies it on its own terms (the stats view breaks down BY
 * status), and a facet is OR within itself but AND across facets.
 */
export type { PriorityBucket }

/** The live facet values, exactly as `useKanbanFilters` holds them. */
export interface KanbanFilterBag {
  statusFilter: Set<KanbanStatus>
  originFilter: Set<OriginFilter>
  priorityFilter: Set<PriorityBucket>
  labelFilter: Set<string>
  assigneeFilter: string
  search: string
}

export function useKanbanTaskFilter(tasks: KanbanTask[], filters: KanbanFilterBag) {
  const { statusFilter, originFilter, priorityFilter, labelFilter, assigneeFilter, search } =
    filters

  /** Most used first, so the label already in use is the first one offered. */
  const labels = useMemo(() => boardLabels(tasks), [tasks])

  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) if (t.assignee) set.add(t.assignee)
    return [...set].sort()
  }, [tasks])

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    )
  }, [tasks, search])

  const matchesFacets = useCallback(
    (t: KanbanTask) => {
      if (originFilter.size > 0 && !originFilter.has(t.origin)) return false
      if (priorityFilter.size > 0 && !priorityFilter.has(priorityBucket(t.priority))) return false
      // Two labels ask for cards carrying EITHER — cards carrying both are the rare case, and
      // requiring both would make a second pick show nothing.
      if (labelFilter.size > 0 && !t.labels.some((label) => labelFilter.has(label))) return false
      if (assigneeFilter && t.assignee !== assigneeFilter) return false
      return true
    },
    [originFilter, priorityFilter, labelFilter, assigneeFilter],
  )

  // Every facet EXCEPT status, so the per-status breakdown stays meaningful.
  const statsScoped = useMemo(() => searched.filter(matchesFacets), [searched, matchesFacets])

  const visible = useMemo(
    () =>
      searched.filter((t) => {
        if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false
        return matchesFacets(t)
      }),
    [searched, statusFilter, matchesFacets],
  )

  return { labels, assignees, statsScoped, visible }
}
