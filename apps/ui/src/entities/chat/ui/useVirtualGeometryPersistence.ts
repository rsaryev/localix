import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import {
  measurementsUsableAtWidth,
  saveChatVirtualMeasurements,
  type ChatScrollSnapshot,
  type ChatVirtualMeasurement,
} from '@/shared/hooks/chatScrollState'

/**
 * Judge and persist a transcript's cached row geometry.
 *
 * The width is 0 on the first render (the parent attaches its scroll ref after the list's layout
 * effects), so the cache can be seeded before it can be judged. Judge it on the first commit that
 * HAS a width and drop it there — `measure()` clears the size cache, so rows re-measure from the
 * estimate instead of replaying heights from another pane width.
 *
 * A warm body keeps its virtualizer instance. If the grid eventually evicts it, persist the
 * measured geometry too; scrollTop alone cannot round-trip a dynamically measured transcript
 * without estimate→actual layout drift.
 */
export function useVirtualGeometryPersistence(
  sessionId: string | null,
  scrollEl: HTMLDivElement | null,
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>,
  cachedVirtualState: ChatScrollSnapshot | undefined | null,
  cachedMeasurements: ChatVirtualMeasurement[] | undefined,
  measuredWidthRef: RefObject<number>,
): void {
  const widthCheckedRef = useRef(false)
  useLayoutEffect(() => {
    if (widthCheckedRef.current || !scrollEl) return
    const width = scrollEl.clientWidth
    if (width <= 0) return
    widthCheckedRef.current = true
    if (!cachedMeasurements) {
      if (cachedVirtualState?.measurements) virtualizer.measure()
      return
    }
    if (measurementsUsableAtWidth(cachedVirtualState?.measurementWidth, width)) return
    virtualizer.measure()
  }, [scrollEl, cachedVirtualState, cachedMeasurements, virtualizer])

  useEffect(
    () => () => {
      if (!sessionId) return
      saveChatVirtualMeasurements(sessionId, virtualizer.takeSnapshot(), measuredWidthRef.current)
    },
    [sessionId, virtualizer, measuredWidthRef],
  )
}
