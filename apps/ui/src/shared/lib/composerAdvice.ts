import { useEffect, useId, useSyncExternalStore } from 'react'

/**
 * One piece of advice above the composer at a time. A recommendation and a tip are both advice
 * the person did not ask for; two stacked strips of it read as clutter, so a tip waits while
 * something more particular to the work (a recommendation) holds the place, and comes back when
 * it is hidden or seen.
 */
const holders = new Set<string>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** While `holding`, this strip has the advice place. */
export function useHoldComposerAdvice(holding: boolean): void {
  const id = useId()
  useEffect(() => {
    if (!holding) return
    holders.add(id)
    notify()
    return () => {
      holders.delete(id)
      notify()
    }
  }, [id, holding])
}

/** Another strip has the advice place: a tip waits. */
export const useComposerAdviceHeld = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => holders.size > 0,
    () => false,
  )
