import { useEffect, useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { setCompactDragImage } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { computeDropIndex } from './dropIndex'

/** Props for the grip. Spread onto the handle button — see `DragHandle`. */
export interface ReorderHandleProps {
  draggable: boolean
  'aria-keyshortcuts': string
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onKeyDown: (event: KeyboardEvent) => void
}

/** Props for the row itself. Spread onto the element the handle sits in. */
export interface ReorderRowProps {
  'aria-setsize': number
  'aria-posinset': number
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
  onDragLeave: () => void
  'data-dragging'?: true
  'data-drop-before'?: true
}

export interface ReorderRow {
  handle: ReorderHandleProps
  row: ReorderRowProps
}

export interface ListReorder {
  /** The id being dragged, or null. */
  draggingId: string | null
  rowProps: (id: string) => ReorderRow
  /**
   * What just happened, for a polite live region.
   *
   * A reorder is otherwise silent to a screen reader: the DOM changes and nothing says so.
   * Every drag library surveyed leaves this to the application, and every application
   * surveyed skipped it.
   */
  announcement: string
}

/** The keyboard gesture, advertised on the handle and spelled once. */
export const REORDER_KEYS = 'Alt+ArrowUp Alt+ArrowDown'

const DRAG_MIME = 'application/x-localix-list-reorder'

export interface ListReorderOptions {
  /** Ids in display order. */
  ids: readonly string[]
  /** Move `id` to `index` in the list WITH `id` removed. */
  onMove: (id: string, index: number) => void
  /** What one row is called, for announcements ("Rule 3"). Defaults to the id. */
  labelOf?: (id: string) => string
}

/**
 * DRAG-TO-REORDER for a vertical list, by a leading grip, with a keyboard path.
 *
 * WHY THIS EXISTS. The workspace rail, the tab strip, the file tree and a task board each
 * grew their own drag machine, and each learned the same lessons separately: Firefox refuses
 * to start a native drag unless `dataTransfer` carries something; `dragover` must
 * `preventDefault` or `drop` never fires at all; a drop index taken against the un-filtered
 * list is off by one when dragging DOWNWARD; and every terminal path — drop, drop outside,
 * drag end — has to funnel back to one reset or an indicator stays on screen. This is the
 * smallest of those machines, for the case that keeps recurring in settings: an ordered list
 * of rows, reordered in place.
 *
 * NATIVE HTML5 DRAG, not pointer events, because that is what the rest of this app uses and
 * because it brings the drag image and container auto-scroll for free. The trade is touch,
 * which native drag does not support — the keyboard path below is the accessible answer, and
 * a coarse-pointer device gets the same Move up / Move down verbs from the row's own menu.
 *
 * THE KEYBOARD PATH IS NOT OPTIONAL. `draggable` is invisible to a keyboard, and in the list
 * this was written for the ORDER IS THE POLICY — inside one scope the last matching rule wins
 * — so a person who cannot drag could read the rules and not change them. `Alt+ArrowUp` and
 * `Alt+ArrowDown` on the focused handle move the row one place, announced politely. A
 * pick-up-then-place mode was the alternative and it is worse here: it swallows the arrow
 * keys, so a mistaken Space traps someone on one row with no visible way out.
 */
export function useListReorder({ ids, onMove, labelOf }: ListReorderOptions): ListReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  /** The row the insertion line sits ABOVE, or null. */
  const [dropBefore, setDropBefore] = useState<string | null>(null)
  // The id in flight, read inside native drag handlers where a stale closure would lie.
  const dragging = useRef<string | null>(null)

  const name = useCallback((id: string) => labelOf?.(id) ?? id, [labelOf])

  const reset = useCallback(() => {
    dragging.current = null
    setDraggingId(null)
    setDropBefore(null)
  }, [])

  useEffect(() => {
    window.addEventListener('dragend', reset, true)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('dragend', reset, true)
      window.removeEventListener('blur', reset)
    }
  }, [reset])

  const place = useCallback(
    (id: string, index: number) => {
      onMove(id, index)
      setAnnouncement(`${name(id)} moved to position ${index + 1} of ${ids.length}`)
    },
    [ids.length, name, onMove],
  )

  const rowProps = useCallback(
    (id: string): ReorderRow => {
      const index = ids.indexOf(id)
      return {
        handle: {
          draggable: true,
          'aria-keyshortcuts': REORDER_KEYS,
          onDragStart: (event) => {
            dragging.current = id
            setDraggingId(id)
            // Firefox and WebKit refuse to start a native drag with an empty payload.
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData(DRAG_MIME, id)
            event.dataTransfer.setData('text/plain', id)
            setCompactDragImage(event.dataTransfer, name(id))
          },
          onDragEnd: reset,
          onKeyDown: (event) => {
            const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
            // Only WITH Alt. Bare arrows belong to the page, and a handle that swallowed
            // them would trap a keyboard user on one row.
            if (delta === 0 || !event.altKey) return
            event.preventDefault()
            const to = Math.max(0, Math.min(index + delta, ids.length - 1))
            if (to !== index) place(id, to)
          },
        },
        row: {
          'aria-setsize': ids.length,
          'aria-posinset': index + 1,
          onDragOver: (event) => {
            const from = dragging.current
            if (!from || from === id) return
            // Without this `drop` never fires at all — the single most common way a native
            // drag implementation appears to work and silently does nothing.
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const box = event.currentTarget.getBoundingClientRect()
            const after = event.clientY > box.top + box.height / 2
            // "After row i" is normalized to "before row i+1", so two adjacent rows can never
            // both draw a line and the indicator cannot flicker between them.
            const marker = after ? (ids[index + 1] ?? null) : id
            setDropBefore(marker)
          },
          onDragLeave: () => {
            if (dragging.current && dropBefore === id) setDropBefore(null)
          },
          onDrop: (event) => {
            const from = dragging.current
            event.preventDefault()
            if (!from || from === id) return reset()
            const box = event.currentTarget.getBoundingClientRect()
            const after = event.clientY > box.top + box.height / 2
            reset()
            place(from, computeDropIndex(ids, from, id, after))
          },
          ...(draggingId === id ? { 'data-dragging': true as const } : {}),
          ...(dropBefore === id ? { 'data-drop-before': true as const } : {}),
        },
      }
    },
    [draggingId, dropBefore, ids, name, place, reset],
  )

  return { draggingId, rowProps, announcement }
}
