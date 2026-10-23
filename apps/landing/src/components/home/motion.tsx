import { useEffect, useState } from 'react'

/**
 * Whether the element is on screen. Without an observer (old browsers, tests) it reports
 * `fallback`, so content that waits for visibility is never stranded.
 */
export function useOnScreen(
  ref: React.RefObject<Element | null>,
  { margin = '0px', fallback = true }: { margin?: string; fallback?: boolean } = {},
) {
  const [onScreen, setOnScreen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(fallback)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin, fallback])
  return onScreen
}
