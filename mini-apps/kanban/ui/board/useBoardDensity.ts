import { useCallback, useSyncExternalStore } from 'react'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

// Board card density — a persistent per-user preference (like the column-collapse
// and editor Outline toggles). `compact` tightens the loose top-level cards to the
// same denser layout epic-grouped cards already use (tighter padding, no scope
// row), so a busy agent board fits more cards per viewport. Backed by localStorage
// and shared across every mounted board via a tiny external store, so the choice
// survives the board tab unmounting on a task open.
export type BoardDensity = 'comfortable' | 'compact'

const KEY = 'localix.kanban.density'
const listeners = new Set<() => void>()
let density = readInitial()

function readInitial(): BoardDensity {
  return loadJSON<BoardDensity>(KEY) === 'compact' ? 'compact' : 'comfortable'
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function toggle() {
  density = density === 'compact' ? 'comfortable' : 'compact'
  saveJSON(KEY, density)
  for (const fn of listeners) fn()
}

/** `[density, toggleDensity]` for board cards, persisted across sessions. */
export function useBoardDensity(): [BoardDensity, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => density,
    () => density,
  )
  const toggleDensity = useCallback(() => toggle(), [])
  return [value, toggleDensity]
}
