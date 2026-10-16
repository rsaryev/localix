import type { KanbanStatus } from '../../shared/contracts'
import { USER_TARGET_STATUSES } from '../../shared/rules'
import { KANBAN_STATUS_LABEL, KANBAN_STATUS_ORDER } from '../model/kanbanStatus'

/** Board lanes, derived from the shared status vocabulary — a column IS a status. */
export const COLUMNS: Array<{ status: KanbanStatus; title: string }> = KANBAN_STATUS_ORDER.map(
  (status) => ({ status, title: KANBAN_STATUS_LABEL[status] }),
)

/**
 * Columns the user may drop into — the rules' own table for a person (`USER_TARGET_STATUSES`), so
 * a drop the board offers is a move the server accepts.
 */
export const DROPPABLE = new Set<KanbanStatus>(USER_TARGET_STATUSES)

export const DAY_MS = 24 * 60 * 60 * 1000
