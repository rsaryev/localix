import { useLayoutEffect, useRef } from 'react'

/**
 * Measures how far a scene's `[data-fly-from]` anchor sits from its `[data-fly-to]` slot and
 * writes the offset to `--fly-x` / `--fly-y`, so a chip can fly from one to the other at any card
 * width. Both anchors must be untransformed elements; the scene re-measures when it resizes.
 */
export function useFlight<T extends HTMLElement>() {
  const root = useRef<T>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => {
      const from = element.querySelector('[data-fly-from]')?.getBoundingClientRect()
      const to = element.querySelector('[data-fly-to]')?.getBoundingClientRect()
      if (!from || !to) return
      element.style.setProperty('--fly-x', `${Math.round(from.left - to.left)}px`)
      element.style.setProperty('--fly-y', `${Math.round(from.top - to.top)}px`)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return root
}
