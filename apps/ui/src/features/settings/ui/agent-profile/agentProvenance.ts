import { agentPolicy } from '@localixai/api/agent-policy'
import type { AgentSummary } from '@/shared/api/contracts'

/**
 * The one line a profile says about where its record came from — and ONLY when the fields
 * cannot simply be edited.
 *
 * It is there to explain a form that will not take your changes, not to narrate provenance. A
 * system agent you may override, or one you already have, says what it is in its own fields;
 * printing "saving writes your override of it" above them was a sentence to step over on every
 * visit to reach the thing the profile was opened for.
 */
export function agentProvenance(agent: AgentSummary): string | undefined {
  if (agent.registration) {
    return `Provided by ${agent.registration.sourceName}. Update this definition through its extension.`
  }
  return agentPolicy(agent).editable.length === 0
    ? 'System agent — the app runs on this one, so it ships as it is. Duplicate it to make changes.'
    : undefined
}
