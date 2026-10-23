import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RAIL_LAYOUT_RESET_EVENT,
  RAIL_LAYOUT_STORAGE_KEY,
  moveRailItem,
  moveWithinRailArea,
  parseRailLayout,
  resetRailLayout,
  resolveRailAreas,
  serializeRailLayout,
  type RailArea,
  type RailItemDef,
  type RailLayoutState,
  type PinnedRailArea,
} from './railLayout'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

export interface RailLayoutApi {
  /** Ordered ids currently pinned to the always-visible bar. */
  bar: string[]
  /** Ordered ids placed in the upper navigation group. */
  top: string[]
  /** Ordered ids tucked into the overflow ("…") menu. */
  overflow: string[]
  /** Ordered ids placed in the lower rail group. */
  bottom: string[]
  /** Ordered ids placed in the horizontal application status bar. */
  status: string[]
  /** Reorder / relocate `id` to `area` at `index` (index within that area). */
  move: (id: string, area: RailArea, index: number) => void
  /** Nudge `id` by `delta` positions within one visible rail area. */
  moveWithin: (id: string, area: PinnedRailArea, delta: number) => void
  /** Reset every entry (order + area) to its default. */
  reset: () => void
}

function load(): RailLayoutState | null {
  return parseRailLayout(loadString(RAIL_LAYOUT_STORAGE_KEY), true)
}

function persist(state: RailLayoutState): void {
  saveString(RAIL_LAYOUT_STORAGE_KEY, serializeRailLayout(state))
}

/**
 * Owns the persisted customizable-rail arrangement. Instantiate ONCE (in the
 * workspace shell) and pass the resolved lists + mutators to every rail render,
 * so the desktop and mobile rails stay in lock-step. `defs` is the live set of
 * customizable entries (recomputed each render); the hook resolves it against the
 * saved state so new/removed entries fold in gracefully.
 */
export function useRailLayout(defs: RailItemDef[]): RailLayoutApi {
  const [state, setState] = useState<RailLayoutState | null>(load)

  const { top, bar, bottom, status, overflow } = useMemo(
    () => resolveRailAreas(defs, state),
    [defs, state],
  )

  const commit = useCallback((next: RailLayoutState) => {
    setState(next)
    persist(next)
  }, [])

  const move = useCallback(
    (id: string, area: RailArea, index: number) => {
      setState((prev) => {
        const next = moveRailItem(defs, prev, id, area, index)
        persist(next)
        return next
      })
    },
    [defs],
  )
  const moveWithin = useCallback(
    (id: string, area: PinnedRailArea, delta: number) => {
      setState((prev) => {
        const next = moveWithinRailArea(defs, prev, id, area, delta)
        persist(next)
        return next
      })
    },
    [defs],
  )
  const reset = useCallback(() => commit(resetRailLayout()), [commit])

  // The page-level "Reset layout" action resets the rail too (users read "Reset
  // layout" as EVERYTHING) — it already broadcasts this window event for the
  // sidebar-width hook; we piggyback rather than prop-drill.
  useEffect(() => {
    window.addEventListener(RAIL_LAYOUT_RESET_EVENT, reset)
    return () => window.removeEventListener(RAIL_LAYOUT_RESET_EVENT, reset)
  }, [reset])

  return { top, bar, bottom, status, overflow, move, moveWithin, reset }
}
