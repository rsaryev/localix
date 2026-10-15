import { useCallback, useMemo, useState } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import { useInfiniteScroll } from '@localixai/plugin-sdk/ui/visibility'
import { availableModelFilters, filterModels, type ModelFilter } from './filterModels'

export const MODEL_PAGE_SIZE = 50

/**
 * One connection's model list: capability filters, search, and the infinite-scroll window.
 * `resetPaging` returns to the first page; `resetFilters` also drops every facet.
 */
export function useModelListPaging(
  models: CatalogModel[],
  providerId: string | undefined,
  search: string,
) {
  const [filters, setFilters] = useState<ModelFilter[]>([])
  const [visibleCount, setVisibleCount] = useState(MODEL_PAGE_SIZE)

  const filteredModels = useMemo(
    () => filterModels(models, providerId, search, filters),
    [models, providerId, search, filters],
  )
  // The connection's whole list, before search and filters: what the facets are offered from
  // and what the header's "4 of 12" counts against.
  const connectionModels = useMemo(() => filterModels(models, providerId, ''), [models, providerId])
  const availableFilters = useMemo(
    () => availableModelFilters(connectionModels),
    [connectionModels],
  )

  const toggleFilter = useCallback((f: ModelFilter) => {
    setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
    setVisibleCount(MODEL_PAGE_SIZE)
  }, [])
  const clearFilters = useCallback(() => {
    setFilters([])
    setVisibleCount(MODEL_PAGE_SIZE)
  }, [])
  const resetPaging = useCallback(() => setVisibleCount(MODEL_PAGE_SIZE), [])

  const visibleModels = useMemo(
    () => filteredModels.slice(0, visibleCount),
    [filteredModels, visibleCount],
  )
  const loadMore = useCallback(() => {
    setVisibleCount((c) => Math.min(c + MODEL_PAGE_SIZE, filteredModels.length))
  }, [filteredModels.length])
  const sentinelRef = useInfiniteScroll(loadMore, visibleCount < filteredModels.length)

  return {
    filters,
    setFilters,
    visibleCount,
    resetPaging,
    filteredModels,
    connectionModels,
    availableFilters,
    toggleFilter,
    clearFilters,
    visibleModels,
    sentinelRef,
  }
}
