import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import { startResizeSession } from './resize-session'
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
  const stopResize = useRef<(() => void) | null>(null)
  useEffect(() => () => stopResize.current?.(), [])

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
      if (e.button !== 0 || stopResize.current) return
      e.preventDefault()
      const start = axis === 'x' ? e.clientX : e.clientY
      const from = size
      setResizing(true)
      const end = () => {
        stopResize.current = null
        setResizing(false)
      }
      stopResize.current = startResizeSession(e, {
        cursor: axis === 'x' ? 'col-resize' : 'row-resize',
        onMove: (next) => {
          const delta = (axis === 'x' ? next.clientX : next.clientY) - start
          setDesired(Math.min(limit, Math.max(min, from + delta * direction)))
        },
        onEnd: end,
        onCancel: () => {
          setDesired(from)
          end()
        },
      })
    },
    [axis, direction, limit, min, size],
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

  // Persist after a drag settles (setState in an event/effect callback, not render).
  // The DESIRED size, so a temporarily narrow window doesn't overwrite the preference.
  useEffect(() => {
    if (!resizing && storageKey) saveJSON(storageKey, desired)
  }, [resizing, desired, storageKey])

  return { size, resizing, onResizeStart, onResizeKeyDown, reset, limit, min }
}
