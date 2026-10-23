import type { PluginAgentDirectory, PluginAgentSummary } from '@localixai/mini-app-sdk/backend'
import { HUMAN_HANDLE } from '@localixai/agent/agents'

import { USER_PARTICIPANT } from '../../db/participant'

/**
 * The host half of `ctx.agents`: which agents a chat can name, answered from the registry.
 *
 * Two rules make it safe to hand to a plugin. The session is resolved BEFORE the registry is
 * read, through an owner-scoped lookup, so a plugin passing a foreign or deleted session id is
 * refused rather than shown another user's agents. And only ENABLED agents of the session's own
 * scope are listed — a name a plugin stores from here must be one the host would also run — plus
 * the person, marked `kind: 'human'`.
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
  /** The person's record in this scope, listed as `@human`. */
  human?: (
    userId: string,
    projectId: string | null,
  ) => Promise<{ label?: string; description: string } | undefined>
  /** Raise the person's mention attention for this (already owner-checked) session. */
  notifyHuman?: (
    userId: string,
    sessionId: string,
    notice: { key: string; from?: string; text: string },
  ) => void
}): PluginAgentDirectory {
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
      const [agents, human] = await Promise.all([
        ports.listAgents(userId, projectId),
        ports.human?.(userId, projectId).catch(() => undefined),
      ])
      // The person is always nameable, last: a card can wait on them, though no agent runs it.
      // Their id is the stored participant ref, the one a card's owner field keeps.
      const person: PluginAgentSummary = {
        id: USER_PARTICIPANT,
        handle: HUMAN_HANDLE,
        kind: 'human',
        ...(human?.label ? { label: human.label } : {}),
        ...(human?.description ? { description: human.description } : {}),
      }
      return [
        ...agents
          .filter((agent) => agent.enabled)
          .map((agent) => ({
            id: agent.id,
            handle: agent.handle,
            ...(agent.description ? { description: agent.description } : {}),
          })),
        person,
      ]
    },
  }
}
