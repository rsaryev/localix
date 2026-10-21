import type { AgentDefinition } from '@localixai/agent/agents'

import { DEFAULT_MAX_TURNS } from '../../../../contracts/turn-budget'

/** A definition's authored limit can tighten, but never raise, the host's turn budget. */
export function runTurnLimit(
  agent: AgentDefinition,
  hostMaxTurns?: number,
  userDefaultMaxTurns?: number,
): number {
  const hostLimit = hostMaxTurns ?? userDefaultMaxTurns ?? DEFAULT_MAX_TURNS
  return Math.min(hostLimit, agent.limits?.maxTurns ?? hostLimit)
}

/**
 * The same limit, from the two bags the run already holds.
 *
 * It exists so the caller can name the figure ONCE and hand the same number to both readers —
 * the loop that enforces it and the reminder that tells the agent about it
 * (`runtime/turn-budget-reminder.ts`). Two call sites recomputing it is how they come to
 * disagree.
 */
export function runTurnLimitFor(
  agent: AgentDefinition,
  scope: { maxTurns?: number },
  userDefaultMaxTurns: number | undefined,
): number {
  return runTurnLimit(agent, scope.maxTurns, userDefaultMaxTurns)
}
