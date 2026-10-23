/**
 * One owner for how a `KanbanStatus` LOOKS: its lane order, its human label, and its
 * `StatusDot` colour.
 *
 * The status TYPE has one owner (`shared/contracts.ts`), but its presentation used to be copied —
 * the board's columns, the transcript card and the composer strip each restated it, and they
 * drifted: the card had no `cancelled` (a cancelled task rendered the raw enum under a grey pip),
 * and a `ready` card read "queued" in the strip and "Ready" on the board it links to.
 *
 * The dot is not a colour of the board's own. Each status maps onto a WORK tone of the host's
 * shared vocabulary (`STATUS_TONE_DOT`), so an amber "running" pip means the same thing on a board
 * card as on a background job or a sub-agent row above the composer.
 *
 * The maps are `Record<KanbanStatus, …>`, so a lane added to the contract fails the type-check
 * here instead of silently rendering a raw enum string.
 */
import { STATUS_TONE_DOT, type WorkStatusTone } from '@localixai/kit/status-dot'

import { KANBAN_STATUSES, type KanbanStatus } from '../../shared/contracts'

/** Lane order: how the board columns, the stat cards and the status filters all read. */
export const KANBAN_STATUS_ORDER: readonly KanbanStatus[] = KANBAN_STATUSES

export const KANBAN_STATUS_LABEL: Record<KanbanStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
}

const STATUS_TONE: Record<KanbanStatus, WorkStatusTone> = {
  backlog: 'idle',
  ready: 'queued',
  in_progress: 'running',
  blocked: 'error',
  review: 'review',
  done: 'done',
  cancelled: 'idle',
}

/** `StatusDot` class per status, through the shared work tones. */
export const KANBAN_STATUS_DOT: Record<KanbanStatus, string> = Object.fromEntries(
  KANBAN_STATUSES.map((status) => [status, STATUS_TONE_DOT[STATUS_TONE[status]]]),
) as Record<KanbanStatus, string>

// A transcript card reads its task out of an `unknown` tool-details payload, so the status reaches
// it as a bare string the type system cannot vouch for. The defensive read lives with the
// vocabulary rather than in every caller.

const isKanbanStatus = (value: string): value is KanbanStatus => value in KANBAN_STATUS_LABEL

/** Dot class for a status off the wire; unknown values get a neutral pip. */
export function kanbanStatusDot(status: string): string {
  return isKanbanStatus(status) ? KANBAN_STATUS_DOT[status] : STATUS_TONE_DOT.idle
}

/** Label for a status off the wire; unknown values render as-is. */
export function kanbanStatusLabel(status: string): string {
  return isKanbanStatus(status) ? KANBAN_STATUS_LABEL[status] : status
}
