import type { RuntimeSection } from '../../agent-core/prompt/runtime-sections'
import { buildTurnBudgetReminder } from './turn-budget-reminder'

export { buildTurnBudgetReminder } from './turn-budget-reminder'

/**
 * `<system-reminder>` facts the agent tends to lose track of — its turn budget — as keyed runtime
 * sections of the turn's context. Language-server errors are shown on the edit that caused them.
 *
 * They used to be a separate, never-persisted message rebuilt every turn. A message that
 * exists in one request and not the next rewrites the history the model already saw, which
 * breaks the provider's prefix cache and, on models with preserved thinking, every thinking
 * block after it. As `state` sections they are sent when they change and stay where they were
 * sent. The background-jobs reminder is gone for the same reason it was a duplicate: the
 * `# Background jobs` runtime section already lists the jobs and states the policy.
 */

/** The reminder facts of this turn, as the runtime sections they are carried in. */
export function reminderSections(inputs: { maxTurns?: number }): RuntimeSection[] {
  const budget = buildTurnBudgetReminder(inputs.maxTurns)
  return budget ? [{ key: 'turn-budget', scope: 'state', text: budget }] : []
}
