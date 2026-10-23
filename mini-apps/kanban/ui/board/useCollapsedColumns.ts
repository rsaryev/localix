import { useCallback, useSyncExternalStore } from 'react'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

import type { KanbanStatus } from '../../shared/contracts'

// Which board columns the user has collapsed to a slim rail — a persistent
// per-user preference (like the editor Outline toggle). Collapsing the terminal
// lanes (Done / Cancelled) is the common case: they're archival noise on an
// agent board, so hiding them widens the active lanes without losing the count.
// Backed by localStorage and shared across every mounted board via a tiny
// external store, so the state survives the board tab unmounting on a task open.
const KEY = 'localix.kanban.collapsedColumns'
const listeners = new Set<() => void>()
let collapsed = readInitial()

function readInitial(): Set<KanbanStatus> {
  const raw = loadJSON<KanbanStatus[]>(KEY)
  return new Set(Array.isArray(raw) ? raw : [])
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function toggle(status: KanbanStatus) {
  const next = new Set(collapsed)
  if (next.has(status)) next.delete(status)
  else next.add(status)
  collapsed = next
  saveJSON(KEY, [...next])
  for (const fn of listeners) fn()
}

/** `[collapsedSet, toggle]` for board columns, persisted across sessions. */
export function useCollapsedColumns(): [Set<KanbanStatus>, (status: KanbanStatus) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => collapsed,
    () => collapsed,
  )
  const toggleColumn = useCallback((status: KanbanStatus) => toggle(status), [])
  return [value, toggleColumn]
}
