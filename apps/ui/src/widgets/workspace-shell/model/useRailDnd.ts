import { useEffect, useCallback, useState } from 'react'
import { setCompactDragImage } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { computeDropIndex, type PinnedRailArea, type RailArea } from './railLayout'
import {
  IDLE_DRAG,
  RAIL_ENTRY_DRAG_MIME,
  beginDrag,
  hoverItem,
  hoverZone,
  leaveZone,
  type RailDrag,
} from './railDrag'

export interface UseRailDndParams {
  /** Current ids for every visible drop zone, in display order. */
  areaIds: Record<PinnedRailArea, string[]>
  onMoveEntry: (id: string, area: RailArea, index: number) => void
}

export interface UseRailDnd {
  drag: RailDrag
  clearDrag: () => void
  /** A customizable entry started being dragged. */
  onDragStart: (e: React.DragEvent, id: string, label: string) => void
  /** Pointer over a bar entry — reveal the insertion guide. */
  onDragOverItem: (e: React.DragEvent, id: string, area: PinnedRailArea) => void
  /** Drop onto another entry — reorder within a zone, or relocate across zones. */
  onDropItem: (e: React.DragEvent, id: string, area: PinnedRailArea) => void
  /** Pointer over the middle zone's dead space. */
  onZoneDragOver: (e: React.DragEvent, area: PinnedRailArea) => void
  /** Pointer left the whole customizable rail zone. */
  onZoneDragLeave: (e: React.DragEvent, area: PinnedRailArea) => void
  /** Drop in dead space — append to the end of the bar. */
  onZoneDrop: (e: React.DragEvent, area: PinnedRailArea) => void
}

/**
 * The transient drag machine for the rail's customizable visible zones. Every
 * terminal path (drop on an item, drop in dead space, Escape,
 * drop outside) funnels back to IDLE via `clearDrag`, so no indicator can get
 * stuck. Pure transitions live in {@link railDrag}; this hook adds the event
 * guards + DOM reads + the reorder/hide calls.
 */
export function useRailDnd({ areaIds, onMoveEntry }: UseRailDndParams): UseRailDnd {
  const [drag, setDrag] = useState<RailDrag>(IDLE_DRAG)
  const clearDrag = useCallback(() => setDrag(IDLE_DRAG), [])

  useEffect(() => {
    window.addEventListener('dragend', clearDrag, true)
    window.addEventListener('blur', clearDrag)
    return () => {
      window.removeEventListener('dragend', clearDrag, true)
      window.removeEventListener('blur', clearDrag)
    }
  }, [clearDrag])

  const onDragStart = useCallback((e: React.DragEvent, id: string, label: string) => {
    // One canonical rail payload/preview for BOTH sources (pinned button and
    // overflow row). The compact drag ghost is shared with context linking, so a
    // wide menu row never obscures the narrow rail drop target.
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(RAIL_ENTRY_DRAG_MIME, id)
    // Firefox/WebKit require a broadly supported payload before starting native DnD.
    e.dataTransfer.setData('text/plain', id)
    setCompactDragImage(e.dataTransfer, label)
    setDrag(beginDrag(id))
  }, [])

  const onDragOverItem = useCallback(
    (e: React.DragEvent, id: string, area: PinnedRailArea) => {
      // Event handling must be synchronous (not inside the state updater, which runs
      // after the handler returns — too late to authorize the drop).
      if (!drag.dragId || drag.dragId === id) return // guard self-drop
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const after =
        area === 'status'
          ? e.clientX > rect.left + rect.width / 2
          : e.clientY > rect.top + rect.height / 2
      setDrag((prev) => hoverItem(prev, id, after, area))
    },
    [drag.dragId],
  )

  const onDropItem = useCallback(
    (e: React.DragEvent, id: string, area: PinnedRailArea) => {
      e.preventDefault()
      e.stopPropagation() // consume — don't let the container's dead-space drop fire too
      if (drag.dragId && drag.dragId !== id) {
        const after = drag.target?.id === id ? drag.target.after : false
        const ids = areaIds[area]
        onMoveEntry(drag.dragId, area, computeDropIndex(ids, drag.dragId, id, after))
      }
      clearDrag()
    },
    [drag, areaIds, onMoveEntry, clearDrag],
  )

  // Dead-space drop inside the middle zone → place the dragged entry at the end.
  const onZoneDragOver = useCallback(
    (e: React.DragEvent, area: PinnedRailArea) => {
      if (drag.dragId) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const clearTarget = e.target === e.currentTarget
        setDrag((prev) => hoverZone(prev, clearTarget, area))
      }
    },
    [drag.dragId],
  )
  const onZoneDragLeave = useCallback((e: React.DragEvent, area: PinnedRailArea) => {
    if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) {
      setDrag((prev) => leaveZone(prev, area))
    }
  }, [])
  const onZoneDrop = useCallback(
    (e: React.DragEvent, area: PinnedRailArea) => {
      e.preventDefault()
      if (drag.dragId) {
        const ids = areaIds[area]
        const rest = ids.filter((x) => x !== drag.dragId)
        onMoveEntry(drag.dragId, area, rest.length)
      }
      clearDrag()
    },
    [drag.dragId, areaIds, onMoveEntry, clearDrag],
  )

  return {
    drag,
    clearDrag,
    onDragStart,
    onDragOverItem,
    onDropItem,
    onZoneDragOver,
    onZoneDragLeave,
    onZoneDrop,
  }
}
