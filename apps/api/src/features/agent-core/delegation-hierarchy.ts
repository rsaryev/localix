/**
 * Only root conversations start subagents (`tools/agent/agent-tool.ts`). A subagent executes its
 * task and reports back; it cannot start subagents of its own, so a tree is one level deep and no
 * chain of agents handing work to each other can form.
 */

/** The deepest a delegated child sits: the root is depth 0, its children depth 1. */
export const MAX_DELEGATION_DEPTH = 1

/** Can a session at this depth delegate at all? Decides whether it is offered the tool. */
export function delegatesAt(depth: number): boolean {
  return depth < MAX_DELEGATION_DEPTH
}

/**
 * What a child is told about delegating, once, with its task. Without it a child spends a turn on
 * a delegation the depth limit refuses.
 */
export function delegationNote(depth: number): string {
  return delegatesAt(depth)
    ? 'You may hand an independent part of this task to a subagent with `Agent`; do the core of it yourself.'
    : 'Do this task yourself: a subagent cannot start subagents of its own.'
}

export interface DelegationPosition {
  /** 0 for a conversation, 1 for its child, and so on. */
  depth: number
  /** Agent ids that created the sessions above this one, root first. */
  chain: readonly string[]
  /** The agent delegating now. */
  self: string | null
}
