/**
 * WHO a session may hand work to, and how much — the shape of a delegation tree.
 *
 * Delegation used to be one level deep by a single bit: a child could never delegate. That kept
 * runaway trees out, and it also kept out the ordinary shape of a team, where the lead hands a
 * task to two colleagues and one of them splits off a piece for the third. Three rules replace
 * the bit, each stopping a specific failure:
 *
 *   A LADDER — each level may involve fewer different agents than the one above it
 *   (`DELEGATION_FANOUT`: 3, then 2, then 1, then none). The tree narrows as it deepens, so it
 *   ends by construction; no level can fan out as wide as the root did.
 *
 *   NO CYCLES — never to yourself (do that part yourself), never to an agent that delegated
 *   work down to you, directly or further up (`chain`). Handing work back up a chain is how two
 *   agents end up waking each other forever; an agent that needs its delegator says so in its
 *   report, or addresses it in a conversation they share.
 *
 *   THE GROUP — in a conversation of several participants, work goes only to those
 *   participants: the people in the room are the team. A solo conversation delegates to any
 *   agent profile, as it always has.
 *
 * A task for SEVERAL agents is one session with all of them in it. Who leads it is not decided
 * here: it is the conversation's own leader rule — the highest `leadershipPriority` — that every
 * multi-participant session already applies (`conversation-strategy.ts`).
 *
 * Counting DIFFERENT agents, not tasks: how many tasks are in flight is the lanes' and the
 * per-human-turn budget's business (`delegation-lanes.ts`, `delegation-budget.ts`).
 *
 * Pure: the host supplies the position and what the session has already engaged; this decides.
 */

/** Different agents a session at depth `i` may involve; past the end, none. */
export const DELEGATION_FANOUT = [3, 2, 1] as const

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
      reason: `At depth ${position.depth} delegation ends. Do this yourself, or report a concrete blocker.`,
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
