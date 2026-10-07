/**
 * Only root conversations delegate. Their children execute the brief and report back;
 * they cannot create another delegation. The root may involve at most three distinct agents.
 * Membership admission belongs to the host, which automatically invites every assignee.
 */

/** Different agents a session at depth `i` may involve; past the end, none. */
export const DELEGATION_FANOUT = [3] as const

export function fanoutAt(depth: number): number {
  return DELEGATION_FANOUT[depth] ?? 0
}

/** Can a session at this depth delegate at all? Decides whether it is offered the tool. */
export function delegatesAt(depth: number): boolean {
  return fanoutAt(depth) > 0
}

/**
 * What a child is told about delegating, once, with its task. Without it a child either never
 * thinks to split off a piece, or spends a turn on a delegation the ladder refuses.
 */
export function delegationNote(depth: number): string {
  const fanout = fanoutAt(depth)
  if (fanout === 0) return 'Do this task yourself: delegation ends at this depth.'
  return (
    `You may split off an independent part with \`agents\` — to at most ${fanout} different ` +
    `agent${fanout === 1 ? '' : 's'}, never to yourself or to an agent that delegated work down ` +
    'to you. Do the core of the task yourself.'
  )
}

export interface DelegationPosition {
  /** 0 for a conversation, 1 for its child, and so on. */
  depth: number
  /** Agent ids that delegated down to this session, root first. */
  chain: readonly string[]
  /** The agent delegating now. */
  self: string | null
  /** Participant agent ids of the conversation when it has several; `null` delegates to profiles. */
  group: readonly string[] | null
}

export interface Assignee {
  agentId: string
  handle: string
}

export type AssigneeAdmission = { ok: true } | { ok: false; reason: string }

/**
 * May `assignees` take one more task from a session at `position` that already involves
 * `engaged`? Every refusal names the rule and what to do instead, because a model handed a bare
 * "not allowed" retries the same call.
 */
export function admitAssignees(
  position: DelegationPosition,
  assignees: readonly Assignee[],
  engaged: ReadonlySet<string>,
): AssigneeAdmission {
  const fanout = fanoutAt(position.depth)
  if (fanout === 0) {
    return {
      ok: false,
      reason:
        'Only a root chat may delegate. Subsessions must do their task or report a concrete blocker.',
    }
  }
  if (assignees.length === 0) return { ok: false, reason: 'A task needs at least one agent.' }
  for (const assignee of assignees) {
    if (assignee.agentId === position.self) {
      return {
        ok: false,
        reason: 'You cannot delegate to yourself — do that part of the work yourself.',
      }
    }
    if (position.chain.includes(assignee.agentId)) {
      return {
        ok: false,
        reason:
          `@${assignee.handle} delegated work down to you, so it cannot take work back from you. ` +
          'Address it directly — in your report, or in a conversation you share.',
      }
    }
    if (position.group && !position.group.includes(assignee.agentId)) {
      return {
        ok: false,
        reason: `@${assignee.handle} is not a participant of this conversation; delegate only to its participants.`,
      }
    }
  }
  const involved = new Set([...engaged, ...assignees.map((assignee) => assignee.agentId)])
  if (involved.size > fanout) {
    return {
      ok: false,
      reason:
        `At depth ${position.depth} a session may involve at most ${fanout} different agent${fanout === 1 ? '' : 's'}, ` +
        `and this would make ${involved.size}. Give the work to an agent you already involve with ` +
        '`agents` action="message", or do it yourself.',
    }
  }
  return { ok: true }
}
