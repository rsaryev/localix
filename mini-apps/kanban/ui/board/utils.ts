import { Check, Play, RotateCcw, Undo2 } from 'lucide-react'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { canTransition, USER_TARGET_STATUSES } from '../../shared/rules'

/**
 * The keyboard-move track — the user-droppable columns in board (left→right) order. Alt+Arrow on
 * a focused card walks it along this track, the exact set of moves a mouse drag can make.
 */
const KEYBOARD_MOVE_TRACK: readonly KanbanStatus[] = USER_TARGET_STATUSES

/**
 * Target column for an Alt+Arrow move of a card in `status`, stepping `dir` (−1 left / +1 right)
 * along the droppable track; null when the card is off the track or the step would fall off
 * either end — there is then no legal keyboard move. Pure.
 */
export function keyboardMoveTarget(status: KanbanStatus, dir: -1 | 1): KanbanStatus | null {
  const i = KEYBOARD_MOVE_TRACK.indexOf(status)
  if (i === -1) return null
  const j = i + dir
  if (j < 0 || j >= KEYBOARD_MOVE_TRACK.length) return null
  return KEYBOARD_MOVE_TRACK[j]!
}

/**
 * The one-click triage action for a task in a given column — the dominant move a person makes
 * while triaging, surfaced on card hover so it does not cost a drag or a panel open. Every action
 * targets `ready`; this records intent without starting work. Epics have no quick action, and
 * cards already ready or in progress need none.
 */
export function quickAction(
  task: KanbanTask,
): { to: KanbanStatus; label: string; Icon: typeof Play } | null {
  if (task.kind === 'epic') return null
  switch (task.status) {
    case 'backlog':
      return { to: 'ready', label: 'Set ready', Icon: Play }
    case 'blocked':
      return { to: 'ready', label: 'Re-queue', Icon: RotateCcw }
    case 'review':
      return { to: 'done', label: 'Approve', Icon: Check }
    case 'done':
      return { to: 'ready', label: 'Reopen', Icon: Undo2 }
    // Already ready or in progress — no quick action. A cancelled card is closed: the rules
    // refuse every move out of it, so offering one would only fail.
    case 'ready':
    case 'in_progress':
    case 'cancelled':
      return null
  }
}

/**
 * Every other column a person may move this card to, in board order — asked of the SAME rules the
 * server applies (`canTransition`), so a menu never offers a move that answers 409: nothing out of
 * `cancelled`, and no epic into `in_progress`.
 */
export function userMoveTargets(task: KanbanTask): KanbanStatus[] {
  return USER_TARGET_STATUSES.filter(
    (status) => status !== task.status && canTransition('user', task.kind, task.status, status).ok,
  )
}

/**
 * Flatten the board's leaf cards into one top-to-bottom, left-to-right id list — the reading
 * order a Shift-click range selects over. Walks the columns in board order and, within each,
 * emits epic-grouped tasks then loose tasks (the render order in `board-columns.tsx`). Epic
 * container cards are excluded: they are not selectable. Pure.
 */
export function flattenLeafIds(
  sectionsByStatus: Map<KanbanStatus, { groups: { tasks: KanbanTask[] }[]; loose: KanbanTask[] }>,
  columns: readonly KanbanStatus[],
): string[] {
  const ids: string[] = []
  for (const status of columns) {
    const section = sectionsByStatus.get(status)
    if (!section) continue
    for (const group of section.groups) for (const t of group.tasks) ids.push(t.id)
    for (const t of section.loose) ids.push(t.id)
  }
  return ids
}

/**
 * Fractional sort orders for inserting `count` cards between the card at `before` and the card at
 * `after` (either may be absent at a column's edge). A single-card drop (count 1) and a multi-card
 * drop share it, so a dragged selection lands contiguously at the drop point in reading order.
 * Between two neighbours the orders divide the gap evenly; at the top they descend below `after`,
 * at the bottom they ascend above `before`, and in an empty column they start at 1. Pure.
 */
export function distributeSortOrders(
  before: number | undefined,
  after: number | undefined,
  count: number,
): number[] {
  const out: number[] = []
  if (before !== undefined && after !== undefined) {
    const step = (after - before) / (count + 1)
    for (let i = 0; i < count; i++) out.push(before + step * (i + 1))
  } else if (before !== undefined) {
    for (let i = 0; i < count; i++) out.push(before + i + 1)
  } else if (after !== undefined) {
    for (let i = 0; i < count; i++) out.push(after - (count - i))
  } else {
    for (let i = 0; i < count; i++) out.push(i + 1)
  }
  return out
}

export function subtaskProgress(task: KanbanTask): { done: number; total: number } {
  return { done: task.subtasks.filter((s) => s.done).length, total: task.subtasks.length }
}

export interface BoardSummary {
  /** Actionable (leaf) tasks that still count toward completion — `cancelled` cards leave the
   *  pipeline so they do not inflate the denominator. */
  total: number
  done: number
  blocked: number
  inProgress: number
}

/**
 * Glanceability roll-up for the board header. Epics are containers, so they do not count;
 * `cancelled` tasks are excluded from `total` so the done/total bar can actually reach 100%. Pure.
 */
export function boardSummary(tasks: KanbanTask[]): BoardSummary {
  let total = 0
  let done = 0
  let blocked = 0
  let inProgress = 0
  for (const t of tasks) {
    if (t.kind === 'epic') continue
    if (t.status !== 'cancelled') total += 1
    switch (t.status) {
      case 'done':
        done += 1
        break
      case 'in_progress':
        inProgress += 1
        break
      case 'blocked':
        blocked += 1
        break
      // Counted in `total` only (or, for `cancelled`, not at all). `review` is no longer
      // in progress but not done either: a person is looking at it.
      case 'backlog':
      case 'ready':
      case 'review':
      case 'cancelled':
        break
    }
  }
  return { total, done, blocked, inProgress }
}
