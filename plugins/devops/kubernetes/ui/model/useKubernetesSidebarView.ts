import { useEffect, useState } from 'react'
import type { ResourceSort } from '../../../ui/model/resourceSort'
import {
  loadK8sView,
  saveK8sView,
  type K8sResourceView,
  type K8sSortKey,
  type K8sViewState,
} from './viewState'

/** Persisted inventory selection, filter, and per-resource sorting. */
export function useKubernetesSidebarView(requestedResource?: K8sResourceView) {
  const [view, setView] = useState<K8sViewState>(loadK8sView)

  const update = (transform: (current: K8sViewState) => K8sViewState) => {
    setView((current) => {
      const next = transform(current)
      if (next === current) return current
      saveK8sView(next)
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
  }, [requestedResource])

  return {
    view,
    setFilter: (filter: string) => update((current) => ({ ...current, filter })),
    setResource: (resource: K8sResourceView) =>
      update((current) => ({ ...current, resource, filter: '' })),
    setSort: (sort: ResourceSort<K8sSortKey>) =>
      update((current) => ({
        ...current,
        sort: { ...current.sort, [current.resource]: sort },
      })),
  }
}
