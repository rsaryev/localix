import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Horizontal scrolling for the SPLIT layout, where each side is exactly half the
 * viewport and only the code moves.
 *
 * The defect it replaces: split rows were two halves of one canvas as wide as the
 * longest line in the whole document, so a single long line (a minified bundle, a
 * lockfile entry) pushed the entire new side thousands of pixels to the right —
 * the right column was simply not on screen. Here the canvas is the viewport's
 * width, gutters stay put, and one native scrollbar under the diff drives a CSS
 * variable (`--diff-x`) that both sides' code is translated by, so the two sides
 * stay aligned and scroll together. Writing the
 * variable directly on the canvas keeps a scroll frame out of React entirely.
 */
export function useSplitScroll({
  enabled,
  scrollEl,
  canvasEl,
  contentCh,
  gutterCh,
  viewportWidth,
}: {
  enabled: boolean
  scrollEl: HTMLElement | null
  canvasEl: HTMLElement | null
  /** Widest line on either side, in columns. */
  contentCh: number
  /** Fixed columns per side before the code (line number + sign). */
  gutterCh: number
  viewportWidth: number
}) {
  // The shared scrollbar's element: a DOM handle, only touched from effects and event handlers.
  const barRef = useRef<HTMLDivElement | null>(null)
  const [chPx, setChPx] = useState(0)

  // One `ch` of the diff's own font, measured where the code renders. The canvas's size is what
  // follows the viewport, so its observer (which also reports once on attach) re-measures.
  useEffect(() => {
    if (!enabled || !canvasEl || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;width:100ch'
      canvasEl.appendChild(probe)
      setChPx(probe.getBoundingClientRect().width / 100)
      probe.remove()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(canvasEl)
    return () => observer.disconnect()
  }, [enabled, canvasEl])

  const sidePx = viewportWidth / 2
  // Code area per side: half the viewport minus its gutter and the 2px change bar.
  const visibleCode = Math.max(0, sidePx - gutterCh * chPx - 2)
  const contentPx = contentCh * chPx + 24
  const overflow = enabled && chPx > 0 ? Math.max(0, contentPx - visibleCode) : 0

  const offset = useRef(0)
  const apply = useCallback(
    (x: number) => {
      offset.current = x
      canvasEl?.style.setProperty('--diff-x', `${x}px`)
    },
    [canvasEl],
  )
  // A relayout that removes the overflow must not leave the code parked off-screen.
  useEffect(() => {
    if (offset.current > overflow) {
      apply(overflow)
      if (barRef.current) barRef.current.scrollLeft = overflow
    }
  }, [overflow, apply])

  // A trackpad's sideways swipe (or Shift+wheel) over the code moves the shared bar.
  useEffect(() => {
    if (!enabled || !scrollEl || overflow === 0) return
    const onWheel = (event: WheelEvent) => {
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (!sideways && !event.shiftKey) return
      const bar = barRef.current
      if (!bar) return
      event.preventDefault()
      bar.scrollLeft += sideways ? event.deltaX : event.deltaY
    }
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel)
  }, [enabled, scrollEl, overflow])

  return {
    overflow,
    barRef,
    onBarScroll: () => barRef.current && apply(barRef.current.scrollLeft),
  }
}
