import { agentPolicy } from '@localixai/api/agent-policy'
import type { AgentSummary } from '@/shared/api/contracts'

/**
 * Explain the owner of a read-only definition, or the scope of a shipped override and its policy.
 */
export function agentProvenance(agent: AgentSummary): string | undefined {
  if (agent.registration) {
    return `Provided by ${agent.registration.sourceName}. Update this definition through its extension.`
  }
  if (agent.builtin) {
    return agent.projectId
      ? 'Standard agent. Definition changes apply in this project; permission rules follow this agent across projects.'
      : 'Standard agent. Definition changes apply in sessions without a project; permission rules follow this agent across projects.'
  }
  return agentPolicy(agent).editable.length === 0
    ? 'System agent — the app runs on this one, so it ships as it is. Duplicate it to make changes.'
    : undefined
}
