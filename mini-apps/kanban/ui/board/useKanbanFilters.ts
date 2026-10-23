import { useEffect, useState } from 'react'
import { toggleInSet } from '@localixai/mini-app-sdk/ui/utilities'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import type { OriginFilter } from './types'
import {
  useKanbanTaskFilter,
  type KanbanFilterBag,
  type PriorityBucket,
} from './useKanbanTaskFilter'

/**
 * Filter state cached at MODULE scope, per chat, so it survives the board tab's unmount.
 *
 * Opening a card and coming back remounts the board from scratch; without the cache every facet
 * reset on that round trip. Keyed by the chat because each chat has its own board: a label filter
 * picked on one chat's board has no meaning on another's, and applying it there would hide cards
 * for a reason nothing on screen explains.
 */
const filterCache = new Map<string, KanbanFilterBag>()

const EMPTY_BAG = (): KanbanFilterBag => ({
  statusFilter: new Set(),
  originFilter: new Set(),
  priorityFilter: new Set(),
  labelFilter: new Set(),
  assigneeFilter: '',
  search: '',
})

/**
 * WHAT THE FILTERS ARE — the facet state of one chat's board and its survival across a remount.
 * The derivation to card lists lives in `useKanbanTaskFilter`, which is pure.
 */
export function useKanbanFilters(sessionId: string, tasks: KanbanTask[]) {
  const [bag, setBag] = useState<KanbanFilterBag>(() => filterCache.get(sessionId) ?? EMPTY_BAG())

  useEffect(() => {
    filterCache.set(sessionId, bag)
  }, [sessionId, bag])

  const { labels, assignees, statsScoped, visible } = useKanbanTaskFilter(tasks, bag)

  const patch = (next: Partial<KanbanFilterBag>) => setBag((prev) => ({ ...prev, ...next }))
  const toggleStatus = (s: KanbanStatus) =>
    setBag((prev) => ({ ...prev, statusFilter: toggleInSet(prev.statusFilter, s) }))
  const toggleOrigin = (o: OriginFilter) =>
    setBag((prev) => ({ ...prev, originFilter: toggleInSet(prev.originFilter, o) }))
  const togglePriority = (p: PriorityBucket) =>
    setBag((prev) => ({ ...prev, priorityFilter: toggleInSet(prev.priorityFilter, p) }))
  const toggleLabel = (label: string) =>
    setBag((prev) => ({ ...prev, labelFilter: toggleInSet(prev.labelFilter, label) }))

  const filterCount =
    bag.statusFilter.size +
    bag.originFilter.size +
    bag.priorityFilter.size +
    bag.labelFilter.size +
    (bag.assigneeFilter ? 1 : 0)

  return {
    ...bag,
    setSearch: (search: string) => patch({ search }),
    setAssigneeFilter: (assigneeFilter: string) => patch({ assigneeFilter }),
    toggleStatus,
    toggleOrigin,
    togglePriority,
    toggleLabel,
    assignees,
    labels,
    statsScoped,
    visible,
    filterCount,
    /** Clear the facets in the Filters menu; search keeps its own control. */
    clearAdvancedFilters: () => setBag((prev) => ({ ...EMPTY_BAG(), search: prev.search })),
    filtersActive: filterCount > 0 || bag.search.trim() !== '',
    resetFilters: () => setBag(EMPTY_BAG()),
  }
}

export type KanbanFilters = ReturnType<typeof useKanbanFilters>
