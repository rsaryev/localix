import type { CatalogAgent } from '@rsaryev/llx-plugin/agents'
import type { TrustSituation } from '@rsaryev/llx-plugin/loading'
import { agentMcpServers, type AgentMcpServers } from '../../../mcp/agent-servers'
import { agentMcpSpecs } from '../../../plugins/kit'
import type { SessionRecord } from '../../repository'

/**
 * The servers a delegated child takes from its agent file's `mcpServers`, for its runs alone. A
 * fork is its delegator rather than the agent, a root chat is not a subagent, and a plugin's agent
 * has none (the kit's `agentMcpSpecs`).
 */
export function agentRunMcpServers(
  session: Pick<SessionRecord, 'provenance'> & { projectId?: string | null },
  agent: Pick<CatalogAgent, 'name' | 'source' | 'definition'> | undefined,
  options: { userId: string; trust: TrustSituation },
): AgentMcpServers | undefined {
  const { provenance } = session
  if (provenance.kind !== 'task-delegation' || provenance.fork) return undefined
  if (!agent?.definition.mcpServers?.length) return undefined
  const specs = agentMcpSpecs(agent, options.trust)
  return agentMcpServers(specs, {
    userId: options.userId,
    projectId: session.projectId ?? '',
    agent: agent.name,
  })
}
