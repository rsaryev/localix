import { useCallback, useMemo, useState, type DragEvent, type RefObject } from 'react'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'

import type { KanbanMove, KanbanStatus, KanbanTask } from '../../shared/contracts'
import { taskUri } from '../../shared/resource'
import { DROPPABLE } from './constants'
import type { DropTarget } from './types'
import { distributeSortOrders } from './utils'

/** Stable empty set so "no drag in flight" never allocates a fresh identity. */
const EMPTY_IDS: ReadonlySet<string> = new Set()

/**
 * The drag gesture: which cards are moving, where the indicator is, and the moves a drop makes.
 *
 * `selectedIdsRef` lets a drag pick up the whole multi-selection: when the grabbed card is part of
 * a selection of more than one, the drop moves every selected leaf card, not just the one under
 * the cursor (native DnD ghosts only the grabbed card, so the rest fade in place). The ref is read
 * at drag START, so it reflects the live selection without re-subscribing the hook.
 *
 * The drop's moves go to `applyMoves` — the board's one write path (`useBoardWrites`), which shows
 * them at once and sends them as one request.
 */
export function useKanbanDrag(
  sessionId: string,
  tasks: KanbanTask[],
  visible: KanbanTask[],
  applyMoves: (moves: KanbanMove[]) => Promise<void>,
  selectedIdsRef?: RefObject<Set<string>>,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Every card moving in the current gesture — the faded "dragging" look and the batch drop.
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(EMPTY_IDS)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const leafTasks = useMemo(() => visible.filter((t) => t.kind !== 'epic'), [visible])
  const epicById = useMemo(
    () => new Map(tasks.flatMap((t) => (t.kind === 'epic' ? [[t.id, t] as const] : []))),
    [tasks],
  )

  const sectionTasks = useCallback(
    (status: KanbanStatus, epicId: string | null) =>
      leafTasks
        .filter(
          (t) =>
            t.status === status &&
            (epicId
              ? t.parentTaskId === epicId
              : !(t.parentTaskId && epicById.has(t.parentTaskId))),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [leafTasks, epicById],
  )

  const completeDrop = useCallback(
    async (target: DropTarget) => {
      const primaryId = draggingId
      const batch = draggingIds
      setDraggingId(null)
      setDraggingIds(EMPTY_IDS)
      setDropTarget(null)
      if (!primaryId) return
      const primary = tasks.find((t) => t.id === primaryId)
      if (!primary) return
      if (primary.kind === 'epic' && target.epicId) return

      // The drag batch's leaf cards, in board reading order (leafTasks preserves it). An epic drag
      // has no leaf members, so it moves just the epic itself.
      const batchIds = batch.size > 1 ? batch : new Set([primaryId])
      const moving = leafTasks.filter((t) => batchIds.has(t.id))
      const movingList = moving.length > 0 ? moving : primary.kind === 'epic' ? [primary] : []
      if (movingList.length === 0) return

      const movingSet = new Set(movingList.map((t) => t.id))
      const section = sectionTasks(target.status, target.epicId).filter((t) => !movingSet.has(t.id))
      const orders = distributeSortOrders(
        section[target.index - 1]?.sortOrder,
        section[target.index]?.sortOrder,
        movingList.length,
      )
      // A card changes epic only when the drop landed in a different group than it was in.
      const parentFor = (t: KanbanTask) =>
        t.kind !== 'epic' && (target.epicId ?? null) !== (t.parentTaskId ?? null)
          ? { parentTaskId: target.epicId }
          : {}
      await applyMoves(
        movingList.map((t, i) => ({
          id: t.id,
          status: target.status,
          sortOrder: orders[i]!,
          ...parentFor(t),
        })),
      )
    },
    [draggingId, draggingIds, tasks, leafTasks, sectionTasks, applyMoves],
  )

  const onSectionDragOver = useCallback(
    (e: DragEvent, status: KanbanStatus, epicId: string | null) => {
      if (!DROPPABLE.has(status) || !draggingId) return
      const dragged = tasks.find((t) => t.id === draggingId)
      if (!dragged || (dragged.kind === 'epic' && epicId)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-task-card]'))
      let index = cards.length
      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i]!.getBoundingClientRect()
        if (e.clientY < rect.top + rect.height / 2) {
          index = i
          break
        }
      }
      setDropTarget((prev) =>
        prev?.status === status && prev.epicId === epicId && prev.index === index
          ? prev
          : { status, epicId, index },
      )
    },
    [draggingId, tasks],
  )

  const onSectionDrop = useCallback(
    (e: DragEvent, status: KanbanStatus, epicId: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      if (!DROPPABLE.has(status)) return
      if (dropTarget?.status === status && dropTarget.epicId === epicId)
        void completeDrop(dropTarget)
    },
    [dropTarget, completeDrop],
  )

  /**
   * Card drag-start, as a callback whose identity changes only with the board it belongs to. The
   * card passes its own task in rather than the board currying a fresh handler per card per
   * render — that curried closure is what made every card's props change on every board render and
   * defeated `memo`.
   */
  const onCardDragStart = useCallback(
    (e: DragEvent, task: KanbanTask) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', task.id)
      // Also arm the message-binding payload, so dropping the card OUTSIDE the board — on the
      // composer — links the card as a resource. Board moves are unaffected: sections key on
      // `draggingId`, not on MIME types.
      setMessageBindingDrag(
        e.dataTransfer,
        createMessageBindingDraft(
          'resource',
          taskUri(sessionId, task.id),
          `${task.id} ${task.title}`,
        ),
      )
      const sel = selectedIdsRef?.current
      const ids = sel?.has(task.id) && sel.size > 1 ? new Set(sel) : new Set([task.id])
      setDraggingId(task.id)
      setDraggingIds(ids)
    },
    [sessionId, selectedIdsRef],
  )

  const onCardDragEnd = useCallback(() => {
    setDraggingId(null)
    setDraggingIds(EMPTY_IDS)
    setDropTarget(null)
  }, [])

  return {
    draggingId,
    draggingIds,
    dropTarget,
    setDropTarget,
    leafTasks,
    epicById,
    onSectionDragOver,
    onSectionDrop,
    onCardDragStart,
    onCardDragEnd,
  }
}

export type KanbanDrag = ReturnType<typeof useKanbanDrag>
