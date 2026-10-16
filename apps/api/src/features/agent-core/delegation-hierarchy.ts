/**
 * Only root conversations create child work, and the only child work an agent creates is a fork
 * of itself (`tools/fork.ts`). A fork executes its task and reports back; it cannot fork again.
 */

/** The deepest a fork sits: the root is depth 0, its forks depth 1. */
export const MAX_FORK_DEPTH = 1

/** Can a session at this depth fork at all? Decides whether it is offered the tool. */
export function delegatesAt(depth: number): boolean {
  return depth < MAX_FORK_DEPTH
}

/**
 * What a fork is told about forking, once, with its task. Without it a fork spends a turn on a
 * fork the depth limit refuses.
 */
export function delegationNote(depth: number): string {
  return delegatesAt(depth)
    ? 'You may fork an independent part of this task with `fork`; do the core of it yourself.'
    : 'Do this task yourself: a fork cannot fork again.'
}

export interface DelegationPosition {
  /** 0 for a conversation, 1 for its child, and so on. */
  depth: number
  /** Agent ids that created the sessions above this one, root first. */
  chain: readonly string[]
  /** The agent forking now. */
  self: string | null
}
