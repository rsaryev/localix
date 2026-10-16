import type { createAgentsService } from '../features/agents/service'
import { HUMAN_HANDLE } from '@localixai/agent/agents'
import { canJoinConversation } from '../features/agents/policy'
import { builtinAgentRecord } from '../features/agents/builtin'

type AgentsService = ReturnType<typeof createAgentsService>

/** Prompt directory and invocation admission are separate views of the same registry. */
export function createAgentDirectoryPorts(agentsService: AgentsService) {
  return {
    // No swallowing: an invitation checked against a registry that failed to load used to see
    // "nobody is available" and told the model the agent did not exist.
    listInvocableRegistryAgents: async (
      userId: string,
      host: string,
      projectId?: string | null,
    ) => {
      const list = await agentsService.listInvocableAgents(userId, host, { projectId })
      return list.map((agent) => ({
        agentId: agent.record.id,
        name: agent.record.handle,
        description: agent.record.description,
        leadershipPriority: agent.record.leadershipPriority,
      }))
    },
    // The directory is advisory prompt context, so a failed read omits it rather than failing
    // the run — but it says so, instead of presenting an empty registry as the truth.
    listRegistryAgents: async (userId: string, projectId?: string | null) => {
      const list = await agentsService.listAgents(userId, { projectId }).catch((error: unknown) => {
        console.warn('[agents] directory unavailable for this run:', error)
        return []
      })
      return list.map((agent) => ({
        agentId: agent.record.id,
        name: agent.record.handle,
        description: agent.record.description,
        leadershipPriority: agent.record.leadershipPriority,
        enabled: agent.enabled,
        canJoinConversation: canJoinConversation(agent),
      }))
    },
    // The person is described from their own record; an unreadable registry falls back to the
    // shipped one rather than dropping `@human` from the prompt.
    resolveHuman: async (...args: Parameters<typeof agentsService.getHuman>) => {
      const record = await agentsService.getHuman(...args).catch((error: unknown) => {
        console.warn('[agents] human record unavailable for this run:', error)
        return builtinAgentRecord(HUMAN_HANDLE)!
      })
      return {
        ...(record.label ? { label: record.label } : {}),
        description: record.description,
        instructions: record.instructions,
      }
    },
  }
}
