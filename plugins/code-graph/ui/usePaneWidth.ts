import { useEffect, useRef, useState } from 'react'

/**
 * Whether the pane is wide enough for the map and the inspector side by side, measured rather than
 * styled: a container-query variant (`@3xl:flex-row`) competes with the host's own base utility of
 * the same specificity, and in the running app the host's won — the inspector landed under the map
 * in a 2000-pixel pane. A measured width cannot lose a cascade.
 */
export function usePaneWidth<T extends HTMLElement>(threshold: number) {
  const ref = useRef<T>(null)
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= threshold)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])
  return [ref, wide] as const
}
