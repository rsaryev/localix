import { agentPolicy } from '@localixai/api/agent-policy'
import type { AgentSummary } from '@/shared/api/contracts'

/**
 * Explain the owner of a read-only definition, or the scope of a shipped override and its policy.
 */
export function agentProvenance(agent: AgentSummary): string | undefined {
  if (agent.source.startsWith('plugin:'))
    return `Provided by the ${agent.source.slice('plugin:'.length)} plugin. Copy it to Yours to change it.`
  if (agent.source === 'managed') return 'Set by your organization. Copy it to Yours to change it.'
  if (agent.source === 'builtin')
    return 'Built in. Copy it to Yours to change it; permission rules follow this agent across projects.'
  return agentPolicy(agent).editable.length === 0 ? 'Copy it to Yours to change it.' : undefined
}
