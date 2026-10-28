import type { MiniAppAgentDirectory } from '@localixai/mini-app-sdk/backend'

/**
 * The host half of `ctx.agents`: which agents a chat can name, answered from the registry.
 *
 * Two rules make it safe to hand to a mini app. The session is resolved BEFORE the registry is
 * read, through an owner-scoped lookup, so a mini app passing a foreign or deleted session id is
 * refused rather than shown another user's agents. And only ENABLED agents of the session's own
 * scope are listed — a name a mini app stores from here must be one the host would also run. The
 * person is not an agent and is not listed.
 *
 * Both halves are ports so the same directory serves the boot-time backend (late-bound refs)
 * and each run's tools (the run's repository), with one answer.
 */
export function createMiniAppAgentDirectory(ports: {
  /** The session's project, or `undefined` when the user owns no such session. */
  sessionProject: (userId: string, sessionId: string) => Promise<string | null | undefined>
  listAgents: (
    userId: string,
    projectId: string | null,
  ) => Promise<
    readonly { id: string; name: string; description?: string | null; enabled: boolean }[]
  >
  /** Raise the person's mention attention for this (already owner-checked) session. */
  notifyHuman?: (
    userId: string,
    sessionId: string,
    notice: { key: string; from?: string; text: string },
  ) => void
}): MiniAppAgentDirectory {
  return {
    async notifyHuman(userId, sessionId, notice) {
      if (!ports.notifyHuman) return
      if ((await ports.sessionProject(userId, sessionId)) === undefined)
        throw new Error('Session not found')
      ports.notifyHuman(userId, sessionId, notice)
    },
    async list(userId, sessionId) {
      const projectId = await ports.sessionProject(userId, sessionId)
      if (projectId === undefined) throw new Error('Session not found')
      return (await ports.listAgents(userId, projectId))
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          ...(agent.description ? { description: agent.description } : {}),
        }))
    },
  }
}
