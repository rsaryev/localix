import type { AppDeps } from '../app'
import { createOwnedAgentRoutes } from '../features/external-agents/backend/owned-session-routes'
import { recordTerminalWork } from '../features/terminal/terminal-work'
import { createAttachAgentRoutes } from '../features/external-agents/backend/attach-session-routes'
import { createLinkAgentRoutes } from '../features/external-agents/backend/link-session-routes'

export function ownedAgentRoutes(
  deps: Pick<
    AppDeps,
    'chatService' | 'terminalService' | 'work' | 'externalAgents' | 'logger' | 'projectsService'
  >,
) {
  return createOwnedAgentRoutes(
    {
      session: (userId, id) => deps.chatService.getSession(userId, id),
      cwd: (userId, id) => deps.chatService.resolveSessionCwd(userId, id),
      terminals: (userId) => deps.terminalService.list(userId),
      spawn: async (userId, sessionId, command) => {
        const terminal = await deps.terminalService.spawnCommand(userId, { sessionId, command })
        recordTerminalWork(deps.work, {
          owner: { userId, sessionId },
          agentId: null,
          label: command,
          terminal,
        })
        return terminal
      },
      reportError: (error) =>
        deps.logger.warn({ event: 'external_agents.identity_save_failed', error: String(error) }),
      remember: (userId, id, key) =>
        deps.chatService.updateSession(userId, id, { externalAgentSessionKey: key }),
    },
    deps.externalAgents,
  )
    .route(
      '/',
      createLinkAgentRoutes({
        session: (userId, id) => deps.chatService.getSession(userId, id),
        link: (userId, id, provider) =>
          deps.chatService.updateSession(userId, id, { externalAgentProvider: provider }),
      }),
    )
    .route(
      '/',
      createAttachAgentRoutes({
        native: async (key) => deps.externalAgents?.nativeSummary(key) ?? null,
        sessions: (userId) => deps.chatService.listSessions(userId),
        project: (userId, id) => deps.projectsService.getProject(userId, id),
        resolveProject: async (userId, cwd) =>
          (await deps.projectsService.resolveProjectByPath(userId, cwd)).project,
        create: (userId, input) => deps.chatService.createSession(userId, input),
      }),
    )
}
