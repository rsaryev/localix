import { useCallback } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import type { KanbanMove, KanbanStatus, KanbanTask } from '../../shared/contracts'
import { canTransition } from '../../shared/rules'
import { boardApi } from '../api/board-client'
import { applyBoardEvent } from '../model/boardStore'
import type { BoardTasks } from '../model/useBoard'

/**
 * Every move and delete a person makes on the board, applied at once and then confirmed.
 *
 * A write shows immediately (the card moves under the pointer) and the server's answer replaces
 * it. The server checks each move against the same transition rules the board offers, and a batch
 * of moves lands together or not at all — so a refusal means NOTHING was written, and reading the
 * board again is an exact undo. The toast says why, because a card snapping back without a
 * sentence reads as a bug.
 *
 * Moves the rules would refuse are dropped before they are sent: a multi-selection that picked up
 * a cancelled card should still move the others, not fail the whole gesture on the one it could
 * never move.
 */
export function useBoardWrites(sessionId: string, board: BoardTasks) {
  const { tasks, setTasks, reconcile } = board

  const refused = useCallback(
    async (title: string, error: unknown) => {
      toast.error(title, { description: errorMessage(error, '') || undefined })
      await reconcile()
    },
    [reconcile],
  )

  /** Send one gesture's moves as one request. */
  const applyMoves = useCallback(
    async (moves: KanbanMove[]) => {
      if (moves.length === 0) return
      const byId = new Map(moves.map((move) => [move.id, move]))
      setTasks((prev) =>
        prev.map((task) => {
          const move = byId.get(task.id)
          return move
            ? {
                ...task,
                status: move.status,
                sortOrder: move.sortOrder,
                ...(move.parentTaskId !== undefined ? { parentTaskId: move.parentTaskId } : {}),
              }
            : task
        }),
      )
      try {
        const written = await boardApi.move(sessionId, moves)
        setTasks((prev) =>
          written.reduce(
            (next, task) => applyBoardEvent(next, { type: 'task.updated', sessionId, task }),
            prev,
          ),
        )
      } catch (error) {
        await refused(
          moves.length > 1 ? `Could not move ${moves.length} tasks` : 'Could not move this task',
          error,
        )
      }
    },
    [sessionId, setTasks, refused],
  )

  const movable = useCallback(
    (task: KanbanTask, to: KanbanStatus) =>
      task.status !== to && canTransition('user', task.kind, task.status, to).ok,
    [],
  )

  /** Append these cards to the bottom of `to`, in the order given. */
  const moveToColumn = useCallback(
    (ids: readonly string[], to: KanbanStatus) => {
      const wanted = new Set(ids)
      const moving = tasks.filter((task) => wanted.has(task.id) && movable(task, to))
      let last = tasks.reduce(
        (max, task) => (task.status === to ? Math.max(max, task.sortOrder) : max),
        0,
      )
      return applyMoves(moving.map((task) => ({ id: task.id, status: to, sortOrder: (last += 1) })))
    },
    [tasks, movable, applyMoves],
  )

  /** The hover quick action, the context menu and a keyboard step: one card, one column. */
  const quickMove = useCallback(
    (taskId: string, to: KanbanStatus) => moveToColumn([taskId], to),
    [moveToColumn],
  )

  /** The selection bar's moves; epics are containers and stay where they are. */
  const batchMove = useCallback(
    (ids: readonly string[], to: KanbanStatus) => {
      const leaves = new Set(tasks.filter((task) => task.kind !== 'epic').map((task) => task.id))
      return moveToColumn(
        ids.filter((id) => leaves.has(id)),
        to,
      )
    },
    [tasks, moveToColumn],
  )

  /**
   * Delete cards one after another: a delete also prunes the dependencies and the epic of the
   * cards around it, so the order a person selected them in is the order they go.
   */
  const batchDelete = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return
      const gone = new Set(ids)
      setTasks((prev) => prev.filter((task) => !gone.has(task.id)))
      let deleted = 0
      try {
        for (const id of ids) {
          // oxlint-disable-next-line react-doctor/async-await-in-loop -- each delete prunes the references the next one reads
          await boardApi.remove(sessionId, id)
          deleted += 1
        }
      } catch (error) {
        await refused(
          ids.length === 1
            ? 'Could not delete this task'
            : `Could not delete ${ids.length - deleted} of ${ids.length} tasks`,
          error,
        )
      }
    },
    [sessionId, setTasks, refused],
  )

  return { applyMoves, quickMove, batchMove, batchDelete }
}
