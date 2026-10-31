import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { mutate } from 'swr'
import type { RealtimeResource } from '@localixai/api/realtime-resources'
import { resourceSync } from './resourceSync'

/**
 * A tab-wide count of how often the server said a resource changed. Unlike a per-hook revision it
 * is the same number for every reader, so a module-level cache can key its entries by it: a read
 * made before the change is never served after it.
 */
const generations = new Map<RealtimeResource, number>()
const watchers = new Map<RealtimeResource, Set<() => void>>()

function watch(resource: RealtimeResource): Set<() => void> {
  const known = watchers.get(resource)
  if (known) return known
  const created = new Set<() => void>()
  watchers.set(resource, created)
  resourceSync.subscribe(resource, () => {
    generations.set(resource, resourceGeneration(resource) + 1)
    for (const listener of created) listener()
  })
  return created
}

export function resourceGeneration(resource: RealtimeResource): number {
  return generations.get(resource) ?? 0
}

export function subscribeResourceGeneration(
  resource: RealtimeResource,
  listener: () => void,
): () => void {
  const set = watch(resource)
  set.add(listener)
  return () => set.delete(listener)
}

/** Re-render on each change of `resource`; returns the tab-wide generation. */
export function useResourceGeneration(resource: RealtimeResource): number {
  // Kept per resource, so a re-render does not unsubscribe and subscribe again.
  const subscribe = useCallback(
    (listener: () => void) => subscribeResourceGeneration(resource, listener),
    [resource],
  )
  return useSyncExternalStore(subscribe, () => resourceGeneration(resource))
}

const revalidated = new Set<string>()

/**
 * Revalidate the SWR cache `key` whenever one of `resources` changes. One subscription per key and
 * resource for the whole tab, however many components read the key; SWR re-reads it only while a
 * component has it mounted.
 */
export function useRevalidateOnResources(key: string, resources: readonly RealtimeResource[]) {
  const names = resources.join(',')
  useEffect(() => {
    for (const resource of names.split(',') as RealtimeResource[]) {
      const id = `${resource}\n${key}`
      if (revalidated.has(id)) continue
      revalidated.add(id)
      subscribeResourceGeneration(resource, () => void mutate(key))
    }
  }, [key, names])
}
