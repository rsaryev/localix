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
      session: (...args) => deps.chatService.getSession(...args),
      cwd: (...args) => deps.chatService.resolveSessionCwd(...args),
      terminals: (...args) => deps.terminalService.list(...args),
      spawn: async (userId, sessionId, command) => {
        const terminal = await deps.terminalService.spawnCommand(userId, { sessionId, command })
        recordTerminalWork(deps.work, {
          owner: { userId, sessionId },
          label: command,
          terminal,
        })
        return terminal
      },
      reportError: (...[error]) =>
        deps.logger.warn({ event: 'external_agents.identity_save_failed', error: String(error) }),
      remember: (userId, id, key) =>
        deps.chatService.updateSession(userId, id, { externalAgentSessionKey: key }),
    },
    deps.externalAgents,
  )
    .route(
      '/',
      createLinkAgentRoutes({
        session: (...args) => deps.chatService.getSession(...args),
        link: (userId, id, provider) =>
          deps.chatService.updateSession(userId, id, { externalAgentProvider: provider }),
      }),
    )
    .route(
      '/',
      createAttachAgentRoutes({
        native: async (...args) => deps.externalAgents?.nativeSummary(...args) ?? null,
        sessions: (...args) => deps.chatService.listSessions(...args),
        project: (...args) => deps.projectsService.getProject(...args),
        resolveProject: async (...args) =>
          (await deps.projectsService.resolveProjectByPath(...args)).project,
        create: (...args) => deps.chatService.createSession(...args),
      }),
    )
}
