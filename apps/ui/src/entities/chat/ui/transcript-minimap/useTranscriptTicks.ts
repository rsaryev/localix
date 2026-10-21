import { useEffect, useRef, useState } from 'react'
import { currentTickAt } from './minimapModel'

export interface TickOffsets {
  /** Scroll offset of each tick's row, in tick order. */
  offsets: number[]
  totalSize: number
}

export interface TickLayout {
  /** 0..1 vertical rail position per tick, in tick order. */
  fractions: number[]
  /** Tick-array index nearest the current viewport position. */
  current: number
  viewportHeight: number
}

const EMPTY_LAYOUT: TickLayout = { fractions: [], current: 0, viewportHeight: 0 }

/**
 * Owns minimap measurement and its cache. Two cadences on purpose:
 * - full recompute (reads `getOffsets` + viewport height) only on content
 *   growth (ResizeObserver on the scroll content) and tick-set changes;
 * - scroll only re-derives `current` from the CACHED offsets — a per-scroll
 *   `getOffsets` would walk the virtualizer's measurements on every frame.
 * Both are rAF-coalesced so a streaming burst costs one read per frame.
 */
export function useTranscriptTicks(
  scrollEl: HTMLElement | null,
  tickCount: number,
  getOffsets: () => TickOffsets,
  /** Remeasure trigger for same-count content swaps (a warm surface switching
   *  sessions keeps this component mounted and can keep the same tick count). */
  resetKey?: string | null,
): TickLayout {
  const [layout, setLayout] = useState<TickLayout>(EMPTY_LAYOUT)
  const cachedOffsetsRef = useRef<number[]>([])

  // Ref-read inside the effect so a new getOffsets identity (ticks changed —
  // already a dependency via tickCount + the render that produced it) doesn't
  // force listener re-subscription on every streamed delta.
  const getOffsetsRef = useRef(getOffsets)
  getOffsetsRef.current = getOffsets

  useEffect(() => {
    if (!scrollEl || tickCount === 0) {
      setLayout(EMPTY_LAYOUT)
      return
    }
    let frame = 0
    let disposed = false

    const recompute = (remeasure: boolean) => {
      if (disposed) return
      if (remeasure) {
        const { offsets, totalSize } = getOffsetsRef.current()
        cachedOffsetsRef.current = offsets
        const viewportHeight = scrollEl.clientHeight
        const safeTotal = Math.max(totalSize, 1)
        setLayout({
          fractions: offsets.map((offset) => Math.min(offset / safeTotal, 1)),
          current: currentTickAt(offsets, scrollEl.scrollTop, viewportHeight),
          viewportHeight,
        })
        return
      }
      const current = currentTickAt(
        cachedOffsetsRef.current,
        scrollEl.scrollTop,
        scrollEl.clientHeight,
      )
      setLayout((prev) => (prev.current === current ? prev : { ...prev, current }))
    }

    // remeasure latches across coalesced frames: a scroll arriving in the same
    // frame as a resize must not downgrade the pending pass to current-only.
    let pendingRemeasure = false
    const schedule = (remeasure: boolean) => {
      pendingRemeasure = pendingRemeasure || remeasure
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const full = pendingRemeasure
        pendingRemeasure = false
        recompute(full)
      })
    }

    recompute(true)
    const onScroll = () => schedule(false)
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    // Observe the scroll CONTENT (first child), not the viewport: streaming grows
    // the content while the viewport box never changes. Guarded — the DOM test
    // environment has no ResizeObserver, and the tick-set dependency still keeps
    // positions honest there.
    let observer: ResizeObserver | null = null
    const content = scrollEl.firstElementChild
    if (typeof ResizeObserver !== 'undefined' && content) {
      observer = new ResizeObserver(() => schedule(true))
      observer.observe(content)
      observer.observe(scrollEl)
    }
    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      scrollEl.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [scrollEl, tickCount, resetKey])

  return layout
}
