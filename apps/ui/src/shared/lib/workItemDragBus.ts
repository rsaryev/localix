import { useSyncExternalStore } from 'react'

/**
 * Pub/sub for an in-flight editor-grid drag — generalizes the 2-dock
 * two-dock shell layout to N groups. A drag carries either a TAB
 * (`itemId` set → move/split that tab) or a whole GROUP (`itemId` null → move the
 * group), plus the source group id. The grid's GroupViews arm it on drag start;
 * the drop overlay reads it synchronously on drop to pick the reducer. Kept in
 * `shared` so the feature (model) and the widget never import each other.
 */
export interface WorkItemDrag {
  /** The dragged tab id, or null when a whole group is being dragged. */
  itemId: string | null
  /** The group the drag originated from. */
  fromGroup: string
}

let current: WorkItemDrag | null = null
const listeners = new Set<() => void>()

export const workItemDragBus = {
  start: (drag: WorkItemDrag) => {
    current = drag
    for (const l of listeners) l()
  },
  end: () => {
    if (current === null) return
    current = null
    for (const l of listeners) l()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Read the in-flight drag synchronously (e.g. on drop), or null when idle. */
  get: () => current,
}

/** Reactively read the in-flight grid drag (null when idle). */
export function useWorkItemDrag(): WorkItemDrag | null {
  return useSyncExternalStore(workItemDragBus.subscribe, workItemDragBus.get, () => null)
}
