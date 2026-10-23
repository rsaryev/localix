import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

export interface ScrollHints {
  /** Attach to the horizontally-scrolling element. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** True when there is more content to the left (scrolled away from the start). */
  canScrollLeft: boolean
  /** True when there is more content to the right (not yet at the end). */
  canScrollRight: boolean
  /** Recompute the hints — wire to the element's `onScroll`. */
  syncScrollHint: () => void
}

/**
 * Tracks whether a horizontally-scrollable element has more content off either
 * edge, so a caller can fade edge gradients in/out. Re-syncs on resize (via a
 * ResizeObserver) while `enabled`, and whenever `resyncDep` changes (e.g. the
 * item count). Extracted from the kanban board — its state is self-contained.
 */
export function useScrollHints(enabled: boolean, resyncDep: unknown): ScrollHints {
  const workItemVisible = useWorkItemVisible()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)

  const syncScrollHint = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
    setCanScrollLeft(el.scrollLeft > 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !enabled || !workItemVisible) return
    syncScrollHint()
    const ro = new ResizeObserver(syncScrollHint)
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, syncScrollHint, resyncDep, workItemVisible])

  return { scrollRef, canScrollLeft, canScrollRight, syncScrollHint }
}
