import { ROOT_DIR_ID } from '../../shared/ids'

/** A place in the map, including the selection or the call trail visible there. */
export interface GraphLocation {
  scope: string
  selected: string | null
  trail: readonly string[]
}

export interface GraphHistory {
  entries: readonly GraphLocation[]
  index: number
}

const LIMIT = 50

export const initialHistory: GraphHistory = {
  entries: [{ scope: ROOT_DIR_ID, selected: null, trail: [] }],
  index: 0,
}

export function currentLocation(history: GraphHistory): GraphLocation {
  return history.entries[history.index] as GraphLocation
}

export function visit(history: GraphHistory, next: GraphLocation): GraphHistory {
  const current = currentLocation(history)
  if (
    current.scope === next.scope &&
    current.selected === next.selected &&
    current.trail.length === next.trail.length &&
    current.trail.every((id, index) => id === next.trail[index])
  ) {
    return history
  }
  const entries = [...history.entries.slice(0, history.index + 1), next].slice(-LIMIT)
  return { entries, index: entries.length - 1 }
}

export function moveHistory(history: GraphHistory, offset: -1 | 1): GraphHistory {
  const index = history.index + offset
  return index < 0 || index >= history.entries.length ? history : { ...history, index }
}
