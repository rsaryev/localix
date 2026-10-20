import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

/** Why a run ended at a turn boundary, by the name of the rule that ended it. */
export interface TurnBoundaryVerdict {
  stop: boolean
  /** Set when a rule fired: the result's `stoppedBy`. */
  name?: string
  /** True when the turn budget ended the run with tool results still unread. */
  budgetExhausted: boolean
}

/**
 * Decide, after a turn's tools have settled, whether the run ends here.
 *
 * The turn budget goes first: reaching it is not itself abnormal — a final answer on the last
 * turn completed naturally — so it stops only when another model request would be needed to
 * read tool results. Host rules follow in their own order, and the first to fire names itself.
 */
export async function judgeTurnBoundary(input: {
  turnsStarted: number
  maxTurns: number | undefined
  hadToolCalls: boolean
  terminated: boolean
  host: AgentRuntimeRunInput['stopWhen']
}): Promise<TurnBoundaryVerdict> {
  const budgetExhausted =
    input.maxTurns !== undefined &&
    input.turnsStarted >= input.maxTurns &&
    !input.terminated &&
    input.hadToolCalls
  if (budgetExhausted) return { stop: true, name: 'turnBudget', budgetExhausted }
  for (const condition of input.host ?? []) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- rules are evaluated in order and the first to fire wins; they never run concurrently
    if (await condition.shouldStop()) return { stop: true, name: condition.name, budgetExhausted }
  }
  return { stop: false, budgetExhausted }
}
