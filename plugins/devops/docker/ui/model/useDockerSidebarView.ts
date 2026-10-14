import { useEffect, useState } from 'react'
import type { ResourceSort } from '../../../ui/model/resourceSort'
import {
  loadDockerView,
  saveDockerView,
  type DockerResourceView,
  type DockerSortKey,
  type DockerViewState,
} from './dockerView'

/** Persisted Docker inventory selection, filter, and per-resource sorting. */
export function useDockerSidebarView(requestedResource?: DockerResourceView) {
  const [view, setView] = useState<DockerViewState>(loadDockerView)

  const update = (transform: (current: DockerViewState) => DockerViewState) => {
    setView((current) => {
      const next = transform(current)
      if (next === current) return current
      saveDockerView(next)
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
    setResource: (resource: DockerResourceView) =>
      update((current) => ({ ...current, resource, filter: '' })),
    setSort: (sort: ResourceSort<DockerSortKey>) =>
      update((current) => ({
        ...current,
        sort: { ...current.sort, [current.resource]: sort },
      })),
  }
}
