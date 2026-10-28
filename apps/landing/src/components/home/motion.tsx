import { useEffect, useState, useSyncExternalStore } from 'react'

const noSubscription = () => () => {}
const hasObserver = () => typeof IntersectionObserver !== 'undefined'

/**
 * Whether the element is on screen. Without an observer (old browsers, tests) it reports
 * `fallback`, so content that waits for visibility is never stranded.
 */
export function useOnScreen(
  ref: React.RefObject<Element | null>,
  { margin = '0px', fallback = true }: { margin?: string; fallback?: boolean } = {},
) {
  const [onScreen, setOnScreen] = useState(false)
  // The server (and hydration) assume an observer exists, so the first render is `false` on both
  // sides; a browser without one then answers with `fallback`.
  const observable = useSyncExternalStore(noSubscription, hasObserver, () => true)
  useEffect(() => {
    const element = ref.current
    if (!element || !observable) return
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin, observable])
  return observable ? onScreen : fallback
}
