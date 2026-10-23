import { useEffect, useState } from 'react'
import type { ResourceSort } from './resourceSort'

/** What a DevOps sidebar remembers: the list on show, its filter, and a sort per list. */
export interface SidebarViewState<Resource extends string, SortKey extends string> {
  filter: string
  resource: Resource
  sort: Record<Resource, ResourceSort<SortKey>>
}

/**
 * Persisted inventory selection, filter, and per-resource sorting — the Docker and Kubernetes
 * sidebars alike. `load`/`save` are the surface's own storage; a requested resource (a deep link)
 * switches the list and clears the filter written for the other one.
 */
export function useSidebarView<View extends SidebarViewState<string, string>>(
  load: () => View,
  save: (view: View) => void,
  requestedResource?: View['resource'],
) {
  const [view, setView] = useState<View>(load)

  const update = (transform: (current: View) => View) => {
    setView((current) => {
      const next = transform(current)
      if (next === current) return current
      save(next)
      return next
    })
  }

  useEffect(() => {
    if (!requestedResource) return
    update((current) =>
      current.resource === requestedResource
        ? current
        : { ...current, resource: requestedResource, filter: '' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request switches the list
  }, [requestedResource])

  return {
    view,
    setFilter: (filter: string) => update((current) => ({ ...current, filter })),
    setResource: (resource: View['resource']) =>
      update((current) => ({ ...current, resource, filter: '' })),
    setSort: (sort: View['sort'][View['resource']]) =>
      update((current) => ({
        ...current,
        sort: { ...current.sort, [current.resource]: sort },
      })),
  }
}
