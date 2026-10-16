import type { PluginAgentDirectory } from '@localixai/plugin-sdk/backend'

/**
 * The host half of `ctx.agents`: which agents a chat can name, answered from the registry.
 *
 * Two rules make it safe to hand to a plugin. The session is resolved BEFORE the registry is
 * read, through an owner-scoped lookup, so a plugin passing a foreign or deleted session id is
 * refused rather than shown another user's agents. And only ENABLED agents of the session's own
 * scope are listed — a name a plugin stores from here must be one the host would also run.
 *
 * Both halves are ports so the same directory serves the boot-time backend (late-bound refs)
 * and each run's tools (the run's repository), with one answer.
 */
export function createPluginAgentDirectory(ports: {
  /** The session's project, or `undefined` when the user owns no such session. */
  sessionProject: (userId: string, sessionId: string) => Promise<string | null | undefined>
  listAgents: (
    userId: string,
    projectId: string | null,
  ) => Promise<
    readonly { id: string; handle: string; description?: string | null; enabled: boolean }[]
  >
}): PluginAgentDirectory {
  return {
    async list(userId, sessionId) {
      const projectId = await ports.sessionProject(userId, sessionId)
      if (projectId === undefined) throw new Error('Session not found')
      const agents = await ports.listAgents(userId, projectId)
      return agents
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          id: agent.id,
          handle: agent.handle,
          ...(agent.description ? { description: agent.description } : {}),
        }))
    },
  }
}
