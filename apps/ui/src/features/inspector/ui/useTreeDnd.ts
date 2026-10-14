import { useEffect, useRef, useState } from 'react'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { canMoveInto, distinctParents } from './fileTreePaths'

/**
 * Payload carried by a drag that ORIGINATED INSIDE the tree, as opposed to the composer
 * @-mention drag (which reads FILE_DRAG_MIME). Keyed separately so a drop onto a folder
 * means "move here" while the composer keeps its own meaning for the same drag.
 */
const TREE_DRAG_MIME = 'application/x-localix-tree-path'

/** Recover the drag's primary path from its MIME data — the fallback for when the
 *  component-local source ref was already cleared (a cross-handler drop). */
const readDragPaths = (e: React.DragEvent): string[] => {
  const raw = e.dataTransfer.getData(TREE_DRAG_MIME)
  return raw ? [raw] : []
}

/**
 * The file tree's drag-and-drop protocol.
 *
 * Three facts drive the whole design and none of them are obvious from a call site:
 *
 *  1. During `dragover` the browser will NOT let us read `dataTransfer.getData` (a
 *     security rule), so validating whether a drop is legal at hover time is impossible
 *     from the event alone. The dragged paths are therefore stashed in a ref on
 *     `dragstart` and read from there; the MIME payload is only the recovery path.
 *  2. A drag that starts on a row belonging to a MULTI-SELECTION carries the whole
 *     selection (reduced to `distinctParents`, so moving a folder does not also try to
 *     move its own children); a drag on an unselected row carries just that row.
 *  3. Default drop = MOVE, Alt/Opt = COPY, signalled through
 *     `dropEffect` so the cursor tells the truth before the drop.
 *
 * A drag is a legal target for `destDir` when AT LEAST ONE dragged entry can move into
 * it. Illegal members of a multi-selection are omitted before submitting a move.
 */
export function useTreeDnd(
  selected: ReadonlySet<string>,
  dropEntries: (
    sources: readonly string[],
    destDir: string,
    copy: boolean,
  ) => void | Promise<unknown>,
) {
  // The path(s) currently being dragged (see fact 1 above), and the row highlighted as
  // the drop target.
  const sourcesRef = useRef<string[] | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  useEffect(() => {
    const end = () => {
      sourcesRef.current = null
      setDragOverKey(null)
    }
    window.addEventListener('dragend', end, true)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('dragend', end, true)
      window.removeEventListener('blur', end)
    }
  }, [])

  /** Start dragging a tree row. `full` is the row's path; `mention` is the payload for a
   *  composer @-mention drop (a folder's carries a trailing slash). */
  const beginDrag = (e: React.DragEvent, full: string, mention: string) => {
    const payload =
      selected.has(full) && selected.size > 1 ? distinctParents([...selected]) : [full]
    const name = full.split('/').pop() || full
    setMessageBindingDrag(e.dataTransfer, createMessageBindingDraft('file', mention), {
      previewLabel: payload.length > 1 ? `${payload.length} items` : name,
    })
    e.dataTransfer.setData(TREE_DRAG_MIME, full)
    e.dataTransfer.setData('text/plain', mention)
    e.dataTransfer.effectAllowed = 'copyMove'
    sourcesRef.current = payload
  }

  const endDrag = () => {
    sourcesRef.current = null
    setDragOverKey(null)
  }

  /** Props that turn an element into a drop target moving the dragged entries into
   *  `destDir`. `rowKey` identifies which row shows the highlight — a folder uses its own
   *  path, a file uses its own path but drops into its PARENT folder. */
  const dropTarget = (rowKey: string, destDir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const srcs = sourcesRef.current
      if (!srcs || !srcs.some((s) => canMoveInto(s, destDir))) return // not a tree drag, or no legal target
      e.preventDefault()
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
      if (dragOverKey !== rowKey) setDragOverKey(rowKey)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null))
        setDragOverKey((cur) => (cur === rowKey ? null : cur))
    },
    onDrop: (e: React.DragEvent) => {
      const srcs = sourcesRef.current ?? readDragPaths(e)
      const legal = srcs.filter((source) => canMoveInto(source, destDir))
      if (!legal.length) return
      e.preventDefault()
      e.stopPropagation()
      setDragOverKey(null)
      sourcesRef.current = null
      void dropEntries(legal, destDir, e.altKey)
    },
  })

  /** Props for the scroll container, so a drop on EMPTY space moves to the tree root.
   *  Gated on `e.target === e.currentTarget` throughout: when the cursor is over a row,
   *  that row's own handlers own the drop and the highlight. */
  const rootDropTarget = (root: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!root || e.target !== e.currentTarget) return
      const srcs = sourcesRef.current
      if (!srcs || !srcs.some((s) => canMoveInto(s, root))) return
      e.preventDefault()
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
      if (dragOverKey !== ROOT_KEY) setDragOverKey(ROOT_KEY)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.target === e.currentTarget) setDragOverKey((cur) => (cur === ROOT_KEY ? null : cur))
    },
    onDrop: (e: React.DragEvent) => {
      const srcs = sourcesRef.current ?? readDragPaths(e)
      if (!root || e.target !== e.currentTarget || !srcs.length) return
      const legal = srcs.filter((source) => canMoveInto(source, root))
      if (!legal.length) return
      e.preventDefault()
      e.stopPropagation()
      setDragOverKey(null)
      sourcesRef.current = null
      void dropEntries(legal, root, e.altKey)
    },
  })

  return {
    dragOverKey,
    isRootOver: dragOverKey === ROOT_KEY,
    beginDrag,
    endDrag,
    dropTarget,
    rootDropTarget,
  }
}

/** Highlight key for the container itself (no row owns the root drop). */
const ROOT_KEY = '__root__'
