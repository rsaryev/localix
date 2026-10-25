import type { createAgentsService } from '../features/agents/service'

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
    listRegistryAgents: (userId: string, projectId?: string | null) =>
      agentsService.directory(userId, projectId).catch((error: unknown) => {
        console.warn('[agents] directory unavailable for this run:', error)
        return []
      }),
  }
}
