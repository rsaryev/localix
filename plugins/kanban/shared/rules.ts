import type { KanbanKind, KanbanStatus, KanbanTask } from './contracts'

/**
 * The board's workflow rules: which moves each actor may make and when a card may be taken.
 * Pure, and shared with the view, because a drop target the server would refuse is a board
 * describing the rule twice — and the copies drift.
 */

/** A board edit is always explicit: a person on the board, or the agent taking its turn. */
export type KanbanActor = 'user' | 'agent'

/**
 * `cancelled` is terminal for both actors: a closed card that silently reopened would carry its
 * old error, assignment and place in the dependency graph back into the work. A person moves
 * cards between the board's own columns; only the agent closes one as `cancelled`.
 */
export const USER_TARGET_STATUSES: readonly KanbanStatus[] = [
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'done',
]

export const AGENT_TARGET_STATUSES: readonly KanbanStatus[] = [...USER_TARGET_STATUSES, 'cancelled']

export function canTransition(
  actor: KanbanActor,
  kind: KanbanKind,
  from: KanbanStatus,
  to: KanbanStatus,
): { ok: true } | { ok: false; why: string } {
  // A same-column write is a reorder or a retitle, not a transition.
  if (from === to) return { ok: true }
  if (from === 'cancelled')
    return { ok: false, why: 'A cancelled task is closed; create a new task for the work.' }
  if (kind === 'epic' && to === 'in_progress')
    return { ok: false, why: 'An epic is a container; take one of its tasks instead.' }
  const targets = actor === 'user' ? USER_TARGET_STATUSES : AGENT_TARGET_STATUSES
  if (!targets.includes(to)) return { ok: false, why: `A task cannot be moved to ${to}.` }
  return { ok: true }
}

/** The columns a card can be taken from; everything else is running or closed. */
export const TAKEABLE_STATUSES: readonly KanbanStatus[] = ['backlog', 'ready', 'blocked']

export type TakeEligibility =
  | { ok: true }
  | { ok: false; reason: 'epic' | 'status' | 'dependencies'; why: string }

/** May this card be taken? One answer, read by the tool and the board alike. */
export function takeEligibility(
  task: Pick<KanbanTask, 'id' | 'kind' | 'status' | 'dependsOn'>,
  board: readonly Pick<KanbanTask, 'id' | 'status'>[],
): TakeEligibility {
  if (task.kind === 'epic')
    return {
      ok: false,
      reason: 'epic',
      why: `${task.id} is an epic container; take one of its tasks instead, and complete the epic itself once they are done.`,
    }
  if (!TAKEABLE_STATUSES.includes(task.status)) {
    const state = task.status === 'in_progress' ? 'in progress' : task.status
    return { ok: false, reason: 'status', why: `${task.id} is already ${state}.` }
  }
  const done = new Set(board.filter((card) => card.status === 'done').map((card) => card.id))
  const unmet = task.dependsOn.filter((id) => !done.has(id))
  if (unmet.length > 0)
    return {
      ok: false,
      reason: 'dependencies',
      why: `${task.id} has unfinished dependencies: ${unmet.join(', ')}.`,
    }
  return { ok: true }
}

/** The speaker's place in its chat, as the host binds it. Missing means leader (older hosts). */
export type BoardRole = 'leader' | 'member' | 'solo'
export interface BoardSpeaker {
  agentId: string
  role?: BoardRole
}

/** The leader, a sole participant, or a call with no speaker sees and edits the whole board. */
export const leadsBoard = (speaker: BoardSpeaker | undefined): boolean => speaker?.role !== 'member'

/** The `update` fields a member may write on its own card; the rest is the leader's triage. */
export const MEMBER_UPDATE_FIELDS: readonly string[] = ['task_id', 'items', 'priority']

type Verdict = { ok: true } | { ok: false; why: string }

/**
 * What a group member may do on the board. A member works only the cards assigned to it; the
 * board's shape — owners, epics, dependencies, wording, columns, deletion — is the leader's.
 * `fields` are the input fields an `update` carries.
 */
export function memberMay(
  action: string,
  task: Pick<KanbanTask, 'id' | 'agentId' | 'assignee'> | null,
  speaker: BoardSpeaker | undefined,
  fields: readonly string[] = [],
): Verdict {
  if (leadsBoard(speaker)) return { ok: true }
  if (action === 'delete' || action === 'reorder')
    return { ok: false, why: `Only the conversation leader can ${action} cards; ask the leader.` }
  if (!task) return { ok: true }
  if (task.agentId !== speaker!.agentId)
    return {
      ok: false,
      why: task.agentId
        ? `${task.id} belongs to @${task.assignee ?? task.agentId}; ask the leader to reassign it.`
        : `${task.id} is unassigned; ask the leader to assign it to you.`,
    }
  if (action !== 'update') return { ok: true }
  const refused = fields.filter((field) => !MEMBER_UPDATE_FIELDS.includes(field))
  if (refused.length)
    return {
      ok: false,
      why: `A member may update only items and priority on its own card; ask the leader to change ${refused.join(', ')}.`,
    }
  return { ok: true }
}

/** The person's directory id: a card assigned to it waits on the human, not on an agent. */
export const HUMAN_ASSIGNEE_ID = 'user'

/** A card the person owns. */
export const isHumanCard = (task: Pick<KanbanTask, 'agentId'>): boolean =>
  task.agentId === HUMAN_ASSIGNEE_ID

/** How a card's owner reads on the board: "you" for the person's own card. */
export const assigneeLabel = (task: Pick<KanbanTask, 'agentId' | 'assignee'>): string | null =>
  isHumanCard(task) ? 'you (@human)' : task.assignee ? `@${task.assignee}` : null
