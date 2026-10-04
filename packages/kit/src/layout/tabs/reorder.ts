import { useRef, useState, type DragEvent } from 'react'

export interface TabReorderOptions<T extends string> {
  /** Drop `fromId` on `toId` (null = the trailing area → move to end). Absent → no reorder. */
  onReorder?: (fromId: T, toId: T | null) => void
  /** Drag started (true, with the id) / ended (false) — lets a host reveal drop zones. */
  onDragStateChange?: (dragging: boolean, id?: T) => void
  /** Arm a CROSS-SURFACE drag (the host sets its own payload). Independent of `onReorder`. */
  onItemDragStart?: (id: T, e: DragEvent) => void
  onItemDragEnd?: () => void
}

/** DOM props for a tab element; `undefined` handlers mean the gesture is not wired. */
export interface TabDragProps {
  draggable: boolean
  onDragStart?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
  onDragEnd?: () => void
}

/** DOM props for the strip's trailing fill (the "move to end" drop target). */
export interface TrailingDropProps {
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: DragEvent) => void
}

export interface TabReorder<T extends string> {
  /** The tab currently in flight (dimmed), or null. */
  draggingId: T | null
  /** The tab the drag hovers (insertion caret before it), or null. */
  dragOverId: T | null
  /** True while the drag hovers the trailing area (drop = move to end). */
  dragOverEnd: boolean
  tabProps: (id: T) => TabDragProps
  trailingProps: TrailingDropProps
}

/**
 * The tab-strip drag gesture: in-strip reorder AND/OR a cross-surface drag out.
 *
 * Owns the whole state machine — which tab is in flight, which drop target is armed,
 * and (the part that used to be copy-pasted at each of the three drop/end sites) what
 * a finished drag must reset. ONE drag serves both targets: `onReorder` arms the
 * in-strip drop zones, `onItemDragStart` lets the host arm its own payload, and
 * whichever target the cursor lands on decides what actually happens.
 */
export function useTabReorder<T extends string>({
  onReorder,
  onDragStateChange,
  onItemDragStart,
  onItemDragEnd,
}: TabReorderOptions<T>): TabReorder<T> {
  const dragId = useRef<T | null>(null)
  const [draggingId, setDraggingId] = useState<T | null>(null)
  const [dragOverId, setDragOverId] = useState<T | null>(null)
  const [dragOverEnd, setDragOverEnd] = useState(false)

  /** Clear every drag cue and tell the host the gesture is over. */
  const endDrag = () => {
    dragId.current = null
    setDragOverId(null)
    setDragOverEnd(false)
    setDraggingId(null)
    onDragStateChange?.(false)
  }

  const draggable = !!onReorder || !!onItemDragStart

  const tabProps = (id: T): TabDragProps => ({
    draggable,
    onDragStart: draggable
      ? (e) => {
          if (onReorder) dragId.current = id
          setDraggingId(id)
          onDragStateChange?.(true, id)
          // Firefox won't start a drag unless dataTransfer carries data.
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(id))
          onItemDragStart?.(id, e)
        }
      : undefined,
    onDragOver: onReorder
      ? (e) => {
          if (dragId.current && dragId.current !== id) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (dragOverId !== id) setDragOverId(id)
          }
        }
      : undefined,
    onDrop: onReorder
      ? (e) => {
          e.preventDefault()
          const from = dragId.current
          endDrag()
          if (from && from !== id) onReorder(from, id)
        }
      : undefined,
    onDragEnd: draggable
      ? () => {
          endDrag()
          onItemDragEnd?.()
        }
      : undefined,
  })

  const trailingProps: TrailingDropProps = {
    onDragOver: onReorder
      ? (e) => {
          // Drop here = move the dragged tab to the end of its group.
          if (dragId.current) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (!dragOverEnd) setDragOverEnd(true)
            if (dragOverId !== null) setDragOverId(null)
          }
        }
      : undefined,
    onDragLeave: onReorder ? () => setDragOverEnd(false) : undefined,
    onDrop: onReorder
      ? (e) => {
          e.preventDefault()
          const from = dragId.current
          endDrag()
          if (from) onReorder(from, null)
        }
      : undefined,
  }

  return { draggingId, dragOverId, dragOverEnd, tabProps, trailingProps }
}
