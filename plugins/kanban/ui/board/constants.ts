import { KANBAN_ORIGINS, type KanbanStatus } from '../../shared/contracts'
import { USER_TARGET_STATUSES } from '../../shared/rules'
import { KANBAN_STATUS_LABEL, KANBAN_STATUS_ORDER } from '../model/kanbanStatus'

/** Board lanes, derived from the shared status vocabulary — a column IS a status. */
export const COLUMNS: Array<{ status: KanbanStatus; title: string }> = KANBAN_STATUS_ORDER.map(
  (status) => ({ status, title: KANBAN_STATUS_LABEL[status] }),
)

/**
 * Statuses available through direct board interaction — the rules' own table for a person
 * (`USER_TARGET_STATUSES`), so a drop the board offers is a move the server accepts.
 */
export const USER_STATUSES: readonly KanbanStatus[] = USER_TARGET_STATUSES

/** Columns the user may drop into — the same set, not a second copy of it. */
export const DROPPABLE = new Set<KanbanStatus>(USER_STATUSES)

/** Every origin the contract can write, so no filter bucket names a state nothing produces. */
export const ORIGIN_FILTERS = KANBAN_ORIGINS

export const DAY_MS = 24 * 60 * 60 * 1000
