import { AgentRunError } from '@localixai/agent/agents'
import type { AgentsService } from '../../../agents/service-contract'
import type { ResolvedRunAgent } from '../../../agents/invocation-service'

/** Admit the saved identity before model resolution can update its session route. */
export async function requireRunAgent(
  resolve: AgentsService['resolveRunAgent'] | undefined,
  userId: string,
  agentId: string,
  host: string,
  projectId: string | null,
  requestApproval?: Parameters<AgentsService['resolveRunAgent']>[4],
): Promise<ResolvedRunAgent> {
  const decision = await resolve?.(userId, agentId, host, projectId, requestApproval)
  if (decision?.status !== 'allowed') {
    throw new AgentRunError(
      'AGENT_UNAVAILABLE',
      `Agent is unavailable: ${agentId} (${decision?.status ?? 'resolver_unavailable'})`,
    )
  }
  if (decision.agent.definition.id !== agentId) {
    throw new AgentRunError('AGENT_UNAVAILABLE', `Agent is unavailable: ${agentId} (id_mismatch)`)
  }
  return decision.agent
}
