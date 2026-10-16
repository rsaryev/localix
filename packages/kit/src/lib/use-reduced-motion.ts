import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type MotionListener = () => void

const listeners = new Set<MotionListener>()
let mediaQuery: MediaQueryList | null = null

function readMediaQuery(): MediaQueryList | null {
  return globalThis.window?.matchMedia?.(REDUCED_MOTION_QUERY) ?? null
}

function emitMotionChange(): void {
  for (const listener of listeners) listener()
}

function subscribeReducedMotion(listener: MotionListener): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    mediaQuery = readMediaQuery()
    mediaQuery?.addEventListener('change', emitMotionChange)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    mediaQuery?.removeEventListener('change', emitMotionChange)
    mediaQuery = null
  }
}

function reducedMotionSnapshot(): boolean {
  return mediaQuery?.matches ?? readMediaQuery()?.matches ?? false
}

export function prefersReducedMotion(): boolean {
  return reducedMotionSnapshot()
}

/**
 * Resolve an explicit programmatic-scroll request against the preference at the
 * moment of the gesture. CSS `scroll-behavior` cannot override a `{ behavior:
 * 'smooth' }` option passed to `scrollTo`/`scrollIntoView`, and reading once at
 * module load would freeze whichever OS value happened to exist at startup.
 */
export function motionSafeScrollBehavior(
  behavior: ScrollBehavior,
  reducedMotion = prefersReducedMotion(),
): ScrollBehavior {
  return reducedMotion && behavior === 'smooth' ? 'auto' : behavior
}

/** Tracks the OS/browser motion preference, including changes made while the UI is open. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false)
}
