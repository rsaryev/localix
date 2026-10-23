import type { DragEvent } from 'react'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'

/**
 * Every gesture a board card can perform, as ONE object whose identity is stable
 * for the lifetime of the board.
 *
 * Why the odd shape (each callback takes the task id / task rather than being
 * pre-bound to a card): a per-card `onOpen: () => open(task.id)` closure is a new
 * function on every board render, so every card's props change on every render and
 * `memo` can never bail out. The board re-renders on each drag-over and on each
 * board stream frame, so that meant re-rendering EVERY card hundreds of times a
 * drag. Passing one frozen action object plus the card's own `task` keeps card
 * props referentially stable, which is what makes the `memo` on `TaskCard`/`EpicCard`
 * actually do something.
 */
export interface CardActions {
  open: (taskId: string) => void
  /** One-click triage move. A move the rules refuse is never sent. */
  quickMove: (taskId: string, to: KanbanStatus) => void
  /** Alt+Arrow move along the user-droppable track (−1 left / +1 right). */
  keyboardMove: (task: KanbanTask, dir: -1 | 1) => void
  /** ⌘/Ctrl (toggle) or Shift (range) click multi-select. */
  select: (taskId: string, mods: { toggle?: boolean; range?: boolean }) => void
  dragStart: (event: DragEvent, task: KanbanTask) => void
  dragEnd: () => void
  /** Ask the board to confirm, then delete this card (context menu). */
  requestDelete: (taskId: string) => void
}
