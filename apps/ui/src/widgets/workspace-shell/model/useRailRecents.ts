import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'
import { RAIL_LAYOUT_RESET_EVENT } from './railLayout'
import {
  RAIL_RECENTS_STORAGE_KEY,
  emptyRailRecents,
  parseRailRecents,
  removeRecent,
  resolveRecents,
  serializeRailRecents,
  touchRecent,
  type RailRecentsState,
} from './railRecents'

export interface RailRecentsApi {
  /** Ordered ids currently rendered as recent slots (newest first). */
  ids: string[]
  /** Record an open: float `id` to the front of the recents. */
  touch: (id: string) => void
  /** Drop `id` from the recents (it got pinned, or the user dismissed it). */
  remove: (id: string) => void
  /** Forget every recent. */
  clear: () => void
}

function load(): RailRecentsState | null {
  return parseRailRecents(loadString(RAIL_RECENTS_STORAGE_KEY))
}

function persist(state: RailRecentsState): void {
  saveString(RAIL_RECENTS_STORAGE_KEY, serializeRailRecents(state))
}

/**
 * Owns the persisted recents list. Instantiate ONCE (in the workspace shell)
 * alongside {@link ./useRailLayout useRailLayout} and pass the resolved ids to
 * every rail render, so the desktop and mobile rails stay in lock-step.
 *
 * `knownIds` is the live set of available entry ids and `pinnedIds` those the user
 * placed by hand; both are filtered out at resolve time rather than on write, so a
 * disabled mini app's slot comes back when the mini app does.
 */
export function useRailRecents(
  knownIds: ReadonlySet<string>,
  pinnedIds: ReadonlySet<string>,
): RailRecentsApi {
  const [state, setState] = useState<RailRecentsState | null>(load)

  const ids = useMemo(
    () => resolveRecents(state, knownIds, pinnedIds),
    [state, knownIds, pinnedIds],
  )

  const touch = useCallback((id: string) => {
    setState((prev) => {
      const next = touchRecent(prev, id)
      persist(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setState((prev) => {
      const next = removeRecent(prev, id)
      persist(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    const next = emptyRailRecents()
    setState(next)
    persist(next)
  }, [])

  // "Reset layout" reads as EVERYTHING, icons included — the rail-layout hook
  // piggybacks on the same page-level event, so recents clear in the same beat.
  useEffect(() => {
    window.addEventListener(RAIL_LAYOUT_RESET_EVENT, clear)
    return () => window.removeEventListener(RAIL_LAYOUT_RESET_EVENT, clear)
  }, [clear])

  return { ids, touch, remove, clear }
}
