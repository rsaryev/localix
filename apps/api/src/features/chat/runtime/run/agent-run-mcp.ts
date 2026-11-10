import { agentMcpServers, type AgentMcpServers } from '../../../mcp/agent-servers'
import { agentMcpSpecs } from '../../../plugins/kit'
import type { SessionRecord } from '../../repository'

/** What a run reads of the agent it runs as to find its `mcpServers`. */
export interface McpAgent {
  source?: string
  fullName?: string
  name?: string
  mcpServers?: readonly unknown[]
}

/**
 * The servers a delegated child takes from its agent file's `mcpServers`, for its runs alone. A
 * fork is its delegator rather than the agent, a root chat is not a subagent, and a plugin's agent
 * has none (the kit's `agentMcpSpecs`).
 */
export function agentRunMcpServers(
  session: Pick<SessionRecord, 'provenance'> & { projectId?: string | null },
  agent: McpAgent | undefined,
  options: { userId: string; projectTrusted: boolean },
): AgentMcpServers | undefined {
  const { provenance } = session
  if (provenance.kind !== 'task-delegation' || provenance.fork) return undefined
  if (!agent?.mcpServers?.length) return undefined
  const specs = agentMcpSpecs(agent.mcpServers, {
    source: agent.source,
    folderTrusted: options.projectTrusted,
  })
  return agentMcpServers(specs, {
    userId: options.userId,
    projectId: session.projectId ?? '',
    agent: agent.fullName ?? agent.name ?? 'agent',
  })
}
