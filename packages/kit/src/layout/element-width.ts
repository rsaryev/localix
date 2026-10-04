import { useEffect, useState, type RefObject } from 'react'

/**
 * The live pixel width of one element — the input an adaptive strip needs and the only one.
 *
 * Deliberately generic and deliberately NOT a media query: chrome that has to decide how much it
 * can show is bounded by the box it sits in, not by the viewport. The titlebar proves it — the
 * same 1200px window gives its breadcrumb a different budget depending on how wide the trailing
 * action cluster grew, and a `max-width` breakpoint cannot see that.
 *
 * `null` until the first measurement lands, so a caller can keep its pre-measurement default
 * rather than render a one-frame layout computed from a width of zero.
 */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Rounded before the compare: sub-pixel jitter from a fractional layout would otherwise
    // re-render every consumer on a resize that cannot change a single decision.
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width)
      setWidth((prev) => (prev === next ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
