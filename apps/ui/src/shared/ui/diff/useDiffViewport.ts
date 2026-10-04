import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Root font size relative to the 14px design root. Diff rows are px-exact for the
 * virtualizer, text is rem; scaling the rows by this keeps the two in step when the
 * user changes the font size.
 */
export function useRootScale(): number {
  return useMemo(() => {
    if (typeof document === 'undefined') return 1
    const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return Number.isFinite(px) && px > 0 ? px / 14 : 1
  }, [])
}

/**
 * The scroll viewport's vertical offset (one update per animation frame) and
 * visible width. The virtualizer only re-renders when its row RANGE changes, which
 * is too coarse for a sticky header that must slide with every pixel; this is the
 * per-frame signal the overlay and the "change n of m" indicator read.
 */
export function useDiffViewport(el: HTMLElement | null): { scrollTop: number; width: number } {
  const [scrollTop, setScrollTop] = useState(0)
  const [width, setWidth] = useState(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!el) return
    const onScroll = () => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        setScrollTop(el.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => setWidth(el.clientWidth))
    observer?.observe(el)
    setWidth(el.clientWidth)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer?.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [el])

  return { scrollTop, width }
}
