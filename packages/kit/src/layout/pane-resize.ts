import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'

export interface PaneResize {
  size: number
  resizing: boolean
  /** Attach to a divider's onPointerDown. */
  onResizeStart: (e: React.PointerEvent) => void
  /** Attach to a divider's onKeyDown — arrow keys nudge, Home/End jump to the bounds. */
  onResizeKeyDown: (e: React.KeyboardEvent) => void
  /** Double-click the divider to reset to the initial size. */
  reset: () => void
  /** The live upper bound, for the divider's `aria-valuemax`. */
  limit: number
  /** The lower bound, for the divider's `aria-valuemin`. */
  min: number
}

/** Keyboard nudge per arrow press; ×4 with Shift, matching the editor's own sash feel. */
const KEY_STEP = 16

/**
 * Clamp a desired pane size to what actually fits.
 *
 * `available` is the container's extent along the axis (null = not measured yet, so the
 * caller's static `max` is the only bound). `reserve` is what the OTHER pane plus the
 * divider must keep — without it a persisted size larger than the container pushes the
 * divider past the viewport edge, and since the divider is the ONLY way to resize or
 * reset, the layout becomes unrecoverable.
 *
 * `min` wins over the container: in a container too small for `min + reserve` there is no
 * satisfying answer, and keeping the pane at `min` at least leaves the divider on screen.
 */
export function clampPaneSize(opts: {
  desired: number
  min: number
  max: number
  available: number | null
  reserve: number
}): number {
  const { desired, min, max, available, reserve } = opts
  const fits = available === null ? max : Math.min(max, available - reserve)
  return Math.min(Math.max(min, fits), Math.max(min, desired))
}

/**
 * Drag-to-resize one pane along an axis ('x' = width, 'y' = height). Pointer math on
 * the window during a drag; the size is clamped to [min, max] AND to what the measured
 * container leaves for the other pane, then persisted to localStorage.
 *
 * SHARED, not database-owned. It was written for the SQL console's editor/results split and
 * lived in that plugin, but nothing in it knows about databases — it is the repo's answer to
 * yaak's `SplitLayout`, and the API workspace needs exactly the same behaviour for its
 * sidebar width and its request/response split. A second copy would have been the alternative.
 *
 * The user's dragged size is what gets persisted; the container limit is applied on top
 * at render time. So shrinking the window squeezes the pane, and growing it back
 * restores the size the user chose instead of silently keeping the squeezed value.
 */
export function usePaneResize(opts: {
  axis: 'x' | 'y'
  /** Which pointer direction grows the pane. Use -1 for a pane anchored to the right or bottom. */
  direction?: 1 | -1
  initial: number
  min: number
  max: number
  storageKey?: string
  /**
   * The element this pane lives in. Without it the pane is bounded only by the static
   * `max`, which can exceed the container and strand the divider off-screen.
   */
  containerRef?: React.RefObject<HTMLElement | null>
  /** Space the other pane + divider must keep. Ignored without `containerRef`. */
  reserve?: number
  /**
   * Re-run measurement when a conditionally-rendered container becomes available. A ref object's
   * identity does not change when `.current` goes from null to an element, so React cannot infer
   * that lifecycle transition from `containerRef` alone.
   */
  measureKey?: unknown
}): PaneResize {
  const workItemVisible = useWorkItemVisible()
  const {
    axis,
    direction = 1,
    initial,
    min,
    max,
    storageKey,
    containerRef,
    reserve = 0,
    measureKey,
  } = opts
  // What the user asked for (dragged / restored from storage) — NOT what fits today.
  const [desired, setDesired] = useState<number>(() => {
    const saved = storageKey ? loadJSON<number>(storageKey) : null
    return typeof saved === 'number' ? Math.min(max, Math.max(min, saved)) : initial
  })
  const [available, setAvailable] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ start: number; from: number } | null>(null)

  // Measure the container so the clamp tracks a resized window / re-split panel. No
  // ResizeObserver (old runtime, SSR) means `available` stays null and the static max
  // remains the only bound — the previous behaviour, not a crash.
  useEffect(() => {
    if (!workItemVisible) return
    const el = containerRef?.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const read = () => {
      const box = el.getBoundingClientRect()
      setAvailable(axis === 'x' ? box.width : box.height)
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [axis, containerRef, measureKey, workItemVisible])

  const limit = useMemo(
    () => clampPaneSize({ desired: Number.POSITIVE_INFINITY, min, max, available, reserve }),
    [min, max, available, reserve],
  )
  const size = clampPaneSize({ desired, min, max, available, reserve })

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      // Start from the size ON SCREEN, not the stored one: after a squeeze those differ,
      // and dragging from the stored value would make the divider jump under the cursor.
      drag.current = { start: axis === 'x' ? e.clientX : e.clientY, from: size }
      setResizing(true)
    },
    [axis, size],
  )

  const nudge = useCallback(
    (delta: number) => setDesired((current) => Math.min(max, Math.max(min, current + delta))),
    [max, min],
  )

  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP
      const positive = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
      const negative = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
      const grow = direction === 1 ? positive : negative
      const shrink = direction === 1 ? negative : positive
      if (e.key === grow) nudge(step)
      else if (e.key === shrink) nudge(-step)
      else if (e.key === 'Home') setDesired(min)
      else if (e.key === 'End') setDesired(max)
      else if (e.key === 'Enter' || e.key === ' ') setDesired(initial)
      else return
      e.preventDefault()
    },
    [axis, direction, initial, max, min, nudge],
  )

  const reset = useCallback(() => {
    setDesired(initial)
    if (storageKey) saveJSON(storageKey, initial)
  }, [initial, storageKey])

  // `size` is a plain number the caller renders as an inline style, so it has to stay
  // in React state — but pointermove fires well above the display's refresh rate (a
  // 120Hz trackpad, coalesced high-frequency mice), and a render per event is work no
  // frame can ever show. One state write per animation frame, carrying the LATEST
  // position, is the same drag with the wasted renders removed.
  useEffect(() => {
    if (!resizing) return
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    let frame: number | null = null
    let pending: number | null = null
    const apply = () => {
      frame = null
      if (pending === null) return
      const next = pending
      pending = null
      setDesired(next)
    }
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = (axis === 'x' ? e.clientX : e.clientY) - d.start
      pending = Math.min(max, Math.max(min, d.from + delta * direction))
      if (!raf) return apply()
      if (frame === null) frame = raf(apply)
    }
    const up = () => {
      // Never drop the final position on the floor: land the pending frame now.
      if (frame !== null && raf) cancelAnimationFrame(frame)
      frame = null
      apply()
      setResizing(false)
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      if (frame !== null && raf) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [resizing, axis, direction, min, max])

  // Persist after a drag settles (setState in an event/effect callback, not render).
  // The DESIRED size, so a temporarily narrow window doesn't overwrite the preference.
  useEffect(() => {
    if (!resizing && storageKey) saveJSON(storageKey, desired)
  }, [resizing, desired, storageKey])

  return { size, resizing, onResizeStart, onResizeKeyDown, reset, limit, min }
}
