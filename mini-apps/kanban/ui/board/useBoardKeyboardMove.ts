import { useCallback, useEffect, useRef, type RefObject } from 'react'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { keyboardMoveTarget } from './utils'

/**
 * The keyboard equivalent of a drag: step the focused card one droppable column
 * along the user track, then follow it with focus so moves can be chained.
 *
 * Routed through the SAME quickMove guard the hover action uses, so keyboard can
 * only make moves a drag could — off-track cards (engine lanes, cancelled) and
 * end-of-track steps yield no target at all.
 */
export function useBoardKeyboardMove(io: {
  quickMove: (taskId: string, to: KanbanStatus) => Promise<void> | void
  /** How many cards a column holds versus renders, so a move can be followed. */
  columnFill: (status: KanbanStatus) => { total: number; hidden: number } | undefined
  ensureColumnShows: (status: KanbanStatus, total: number) => void
  /** Recomputed whenever the rendered cards change — when a moved card can take focus. */
  renderedKey: unknown
  scrollRef: RefObject<HTMLElement | null>
}): (task: KanbanTask, dir: -1 | 1) => void {
  const { quickMove, columnFill, ensureColumnShows, renderedKey, scrollRef } = io
  const pendingFocusRef = useRef<string | null>(null)

  const keyboardMove = useCallback(
    (task: KanbanTask, dir: -1 | 1) => {
      const to = keyboardMoveTarget(task.status, dir)
      if (!to) return
      // The move appends the card to the BOTTOM of the destination lane, which is
      // exactly where a capped lane stops rendering — so grow that lane's budget to
      // cover its whole contents first. Without this the moved card has no DOM node,
      // the focus restore below finds nothing, and the user cannot chain moves. The
      // budget rise is bounded to one lane and only ever user-initiated.
      const destination = columnFill(to)
      if (destination && destination.hidden > 0) ensureColumnShows(to, destination.total + 1)
      pendingFocusRef.current = task.id
      void quickMove(task.id, to)
    },
    [quickMove, columnFill, ensureColumnShows],
  )

  // Runs whenever the rendered cards recompute (an optimistic move changes the task
  // set); if a keyboard move just requested it, restore focus to the card in its new
  // column. Clearing the ref is not setState.
  useEffect(() => {
    const id = pendingFocusRef.current
    if (!id) return
    pendingFocusRef.current = null
    scrollRef.current?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)?.focus()
    // Keyed on what is RENDERED: the moved card can only take focus once its lane's
    // render budget covers it (see above).
  }, [renderedKey, scrollRef])

  return keyboardMove
}
