import { useCallback, useRef, useSyncExternalStore } from 'react'
import { miniAppActivationVersion, subscribeMiniAppActivation } from './miniAppActivation'
import { registryChangeVersion, subscribeRegistryChanges } from './registryChanges'

/**
 * Re-render when THIS consumer's piece of the mini app registries moves — and only then.
 *
 * A surface that read a registry during render (`sessionSurfacesFor`, `workItemSlot`, a kind's
 * contribution) used to re-read it only when its parent re-rendered, so a mini app registering
 * after the first paint stayed invisible under it. Subscribing every such surface to one global
 * counter would fix that and bring back the other defect — every registry flush re-rendering every
 * tab, strip and slot on screen. So each consumer names its slice: the flush re-runs the selector,
 * and React re-renders only when the slice differs from the last one by `sameSlice` (element-wise
 * for arrays, `Object.is` otherwise).
 *
 * The slice is recomputed only when the registries or the activation state moved since it was
 * cached, which keeps `getSnapshot` stable as `useSyncExternalStore` requires.
 */
export function useMiniAppRegistrySlice<T>(key: string, select: () => T): T {
  const cache = useRef<{ key: string; stamp: string; value: T } | null>(null)
  const selectRef = useRef(select)
  selectRef.current = select
  const getSnapshot = useCallback((): T => {
    const stamp = `${registryChangeVersion()}:${miniAppActivationVersion()}`
    const held = cache.current
    if (held?.key === key && held.stamp === stamp) return held.value
    const next = selectRef.current()
    const value = held?.key === key && sameSlice(held.value, next) ? held.value : next
    cache.current = { key, stamp, value }
    return value
  }, [key])
  return useSyncExternalStore(subscribeMiniAppRegistry, getSnapshot, getSnapshot)
}

/** Registry flushes and activation broadcasts: the two ways a registry read can change. */
export function subscribeMiniAppRegistry(listener: () => void): () => void {
  const offRegistry = subscribeRegistryChanges(listener)
  const offActivation = subscribeMiniAppActivation(listener)
  return () => {
    offRegistry()
    offActivation()
  }
}

/** Arrays compare element-wise (a registry list is rebuilt per read); anything else by identity. */
export function sameSlice(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((entry, index) => sameSlice(entry, right[index]))
}
