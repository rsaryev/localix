import { useEffect, useEffectEvent, useRef, useState, type DragEvent } from 'react'
import {
  setCompactDragImage,
  setElementDragImage,
  WORKSPACE_TAB_DRAG_MIME,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'

export interface TabReorderOptions<T extends string> {
  ids?: readonly T[]
  /** Drop `fromId` on `toId` (null = the trailing area → move to end). Absent → no reorder. */
  onReorder?: (fromId: T, toId: T | null) => void
  /** Drag started (true, with the id) / ended (false) — lets a host reveal drop zones. */
  onDragStateChange?: (dragging: boolean, id?: T) => void
  /** Arm a CROSS-SURFACE drag (the host sets its own payload). Independent of `onReorder`. */
  onItemDragStart?: (id: T, e: DragEvent) => void
  onItemDragEnd?: (id: T, event: globalThis.DragEvent | null, cancelled: boolean) => void
}

/** DOM props for a tab element; `undefined` handlers mean the gesture is not wired. */
export interface TabDragProps {
  draggable: boolean
  onDragStart?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
  onDragEnd?: (e: DragEvent) => void
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
  ids,
  onReorder,
  onDragStateChange,
  onItemDragStart,
  onItemDragEnd,
}: TabReorderOptions<T>): TabReorder<T> {
  const dragId = useRef<T | null>(null)
  const inFlight = useRef(false)
  const cancelled = useRef(false)
  const dropped = useRef(false)
  const stopObservingKeys = useRef<(() => void) | null>(null)
  const [draggingId, setDraggingId] = useState<T | null>(null)
  const [dragOverId, setDragOverId] = useState<T | null>(null)
  const [dragOverEnd, setDragOverEnd] = useState(false)

  /** Clear every drag cue and tell the host the gesture is over. */
  const endDrag = (event: globalThis.DragEvent | null = null, aborted = false) => {
    if (!inFlight.current) return
    inFlight.current = false
    const id = dragId.current
    const wasCancelled = aborted || cancelled.current || dropped.current
    dragId.current = null
    stopObservingKeys.current?.()
    stopObservingKeys.current = null
    setDragOverId(null)
    setDragOverEnd(false)
    setDraggingId(null)
    onDragStateChange?.(false)
    if (id) onItemDragEnd?.(id, event, wasCancelled)
  }

  // The window-level listeners below outlive any one render, so they reach the newest
  // `endDrag` (and the host callbacks it closes over) through effect events.
  const endFromWindow = useEffectEvent((event: globalThis.DragEvent) => endDrag(event))
  const abandonDrag = useEffectEvent(() => {
    if (!inFlight.current) return
    inFlight.current = false
    onDragStateChange?.(false)
    const id = dragId.current
    if (id) onItemDragEnd?.(id, null, true)
  })
  useEffect(() => {
    const end = (event: globalThis.DragEvent) => endFromWindow(event)
    // Finder can focus before WebKit sends dragend. Blur clears hover feedback,
    // but the source and cancellation state must survive until that final event.
    const blur = () => {
      setDragOverId(null)
      setDragOverEnd(false)
    }
    const accept = () => {
      if (inFlight.current) dropped.current = true
    }
    window.addEventListener('dragend', end, true)
    window.addEventListener('blur', blur)
    window.addEventListener('drop', accept, true)
    return () => {
      window.removeEventListener('dragend', end, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('drop', accept, true)
      stopObservingKeys.current?.()
      abandonDrag()
    }
  }, [])

  const draggable = !!onReorder || !!onItemDragStart
  const slotAt = (id: T, event: DragEvent): T | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!ids || event.clientX < rect.left + rect.width / 2) return id
    const remaining = ids.filter((value) => value !== dragId.current)
    return remaining[remaining.indexOf(id) + 1] ?? null
  }

  const tabProps = (id: T): TabDragProps => ({
    draggable,
    onDragStart: draggable
      ? (e) => {
          dragId.current = id
          cancelled.current = false
          dropped.current = false
          const observeEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') cancelled.current = true
          }
          // Escape cancels the OS drag. This observer never claims a key or executes a command.
          // oxlint-disable-next-line localix/no-global-key-listener
          window.addEventListener('keydown', observeEscape, true)
          stopObservingKeys.current = () =>
            window.removeEventListener('keydown', observeEscape, true)
          inFlight.current = true
          setDraggingId(id)
          onDragStateChange?.(true, id)
          // Internal tabs are never desktop exports. Plain text/URLs let Finder
          // accept the gesture and create a clipping before our tear-out runs.
          e.dataTransfer.clearData()
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(WORKSPACE_TAB_DRAG_MIME, String(id))
          setCompactDragImage(e.dataTransfer, e.currentTarget.textContent?.trim() || id)
          onItemDragStart?.(id, e)
          setElementDragImage(e.dataTransfer, e.currentTarget, e)
        }
      : undefined,
    onDragOver: onReorder
      ? (e) => {
          if (dragId.current && dragId.current !== id) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const slot = slotAt(id, e)
            setDragOverId(slot)
            setDragOverEnd(slot === null)
          }
        }
      : undefined,
    onDrop: onReorder
      ? (e) => {
          const from = dragId.current
          // A foreign drag belongs to the host's cross-group drop target. Clearing its
          // global drag here would erase the payload before the parent can consume it.
          if (!from) return
          e.preventDefault()
          e.stopPropagation()
          const slot = slotAt(id, e)
          endDrag()
          if (from !== id) onReorder(from, slot)
        }
      : undefined,
    onDragLeave: (e) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setDragOverId(null)
    },
    onDragEnd: draggable ? (event) => endDrag(event.nativeEvent) : undefined,
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
          const from = dragId.current
          if (!from) return
          e.preventDefault()
          e.stopPropagation()
          endDrag()
          if (from) onReorder(from, null)
        }
      : undefined,
  }

  return { draggingId, dragOverId, dragOverEnd, tabProps, trailingProps }
}
