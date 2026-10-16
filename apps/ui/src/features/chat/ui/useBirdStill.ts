import { useSyncExternalStore } from 'react'

const reducedQuery = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia(reducedQuery)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** Whether the bird should be drawn at rest: the user asked the system for reduced motion. */
export function useBirdStill(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  )
}
