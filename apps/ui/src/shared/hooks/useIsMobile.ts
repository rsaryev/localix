import { useEffect, useState } from 'react'

/** Viewport width at/below which the workspace switches to its mobile layout. */
export const MOBILE_QUERY = '(max-width: 639px)'

/** Imperative one-shot read of the mobile breakpoint — for non-reactive call sites
 *  (state initializers, event handlers) that just need the current value. Components
 *  that should re-render on viewport changes use {@link useIsMobile} instead. */
export function isMobileViewport(): boolean {
  // Reached through `globalThis` on purpose: this module is imported by code that also runs
  // outside a DOM (tests, SSR), where a BARE `window` is not merely undefined — it is
  // undeclared, and touching it throws a ReferenceError that no `?.` can catch. A property
  // of `globalThis` is always a safe read.
  return globalThis.window?.matchMedia(MOBILE_QUERY).matches ?? false
}

/** True on a phone-sized viewport — used to suppress desktop-only affordances
 *  (e.g. auto-opening the inspector, which is a full overlay on mobile). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}
